import { Extractor } from "./AbstractExtractor.js";
import {
  addContributor,
  addMapping,
  cleanText,
  collectObject,
  getCoverData,
  normalizeReadingFormat,
} from "../shared/utils.js";

const ADLIBRIS_PATTERN = /^https?:\/\/(?:www\.)?adlibris\.com\/(?:[a-z]{2}\/)?(?:bok|book|bog|kirja)\/.+(?:-|\/)(\d{10,13})(?:[/?#].*)?$/i;

const PRODUCT_LABELS = new Set([
  "Författare",
  "Formgivare",
  "Illustratör",
  "ISBN",
  "Språk",
  "Vikt",
  "Utgivningsdatum",
  "Förlag",
  "Sidor",
  "Speltid",
  "Upplaga",
  "Uppläsare",
]);

const SECTION_ENDINGS = new Set([
  "Kundrecensioner",
  "Upptäck mer",
  "Mer på Adlibris",
  "Leverans & betalning",
  "Fler bokformat",
]);

const LANGUAGE_MAP = {
  danska: "Danish",
  engelska: "English",
  finska: "Finnish",
  franska: "French",
  italienska: "Italian",
  nederländska: "Dutch",
  norska: "Norwegian",
  polska: "Polish",
  portugisiska: "Portuguese",
  ryska: "Russian",
  spanska: "Spanish",
  svenska: "Swedish",
  tyska: "German",
};

class adlibrisScraper extends Extractor {
  get _name() { return "Adlibris Extractor"; }
  needsReload = false;

  _sitePatterns = [
    ADLIBRIS_PATTERN,
  ];

  async getDetails() {
    const details = extractDetails(document);
    return collectObject([
      getCoverData(getCoverUrls(document, details.Title)),
      details,
    ]);
  }

  normalizeUrl(url) {
    const match = url.match(ADLIBRIS_PATTERN);
    if (!match) return super.normalizeUrl(url);

    try {
      const parsed = new URL(url);
      return `${parsed.origin}${parsed.pathname}`;
    } catch {
      return url || "";
    }
  }
}

function extractDetails(doc) {
  const lines = getLines(doc);
  const productInfo = getProductInfo(lines);
  const jsonLd = getBookJsonLd(doc);
  const details = {};
  const mappings = {};

  const isbn = cleanIsbn(firstValue(productInfo.ISBN) || jsonLd?.isbn || getIsbnFromUrl(doc.location?.href || ""));
  if (isbn.length === 13) details["ISBN-13"] = isbn;
  if (isbn.length === 10) details["ISBN-10"] = isbn;
  if (isbn) addMapping(mappings, "Adlibris", isbn);

  const title = getTitle(doc, jsonLd);
  if (title) details.Title = title;

  const description = getDescription(lines) || cleanHtml(jsonLd?.description);
  if (description) details.Description = description;

  const publisher = firstValue(productInfo["Förlag"]) || getName(jsonLd?.publisher);
  if (publisher) details.Publisher = publisher;

  const publicationDate = firstValue(productInfo["Utgivningsdatum"]) || jsonLd?.datePublished;
  if (publicationDate) details["Publication date"] = cleanText(publicationDate);

  const language = normalizeLanguage(firstValue(productInfo["Språk"]) || jsonLd?.inLanguage);
  if (language) details.Language = language;

  const pages = cleanText(firstValue(productInfo["Sidor"]) || jsonLd?.numberOfPages || "");
  if (pages) details.Pages = pages.replace(/[^\d]/g, "") || pages;

  const edition = firstValue(productInfo["Upplaga"]);
  if (edition) details["Edition Information"] = `Upplaga ${edition}`;

  const weight = firstValue(productInfo["Vikt"]);
  if (weight) details.Weight = weight;

  const format = normalizeEditionFormat(getFormat(doc, lines, jsonLd));
  if (format) {
    details["Edition Format"] = format;
    details["Reading Format"] = normalizeReadingFormat(format);
  }

  const listeningLength = firstValue(productInfo["Speltid"]);
  if (listeningLength) {
    details["Listening Length"] = listeningLength;
    const seconds = parseListeningLengthSeconds(listeningLength);
    if (seconds) details["Listening Length Seconds"] = seconds;
  }

  const contributors = getContributors(productInfo, jsonLd);
  if (contributors.length) details.Contributors = contributors;

  if (Object.keys(mappings).length) details.Mappings = mappings;

  return details;
}

function getTitle(doc, jsonLd) {
  return cleanText(
    doc.querySelector?.("h1")?.textContent
    || jsonLd?.name
    || doc.title?.split(" - ")[0]
    || ""
  );
}

function getDescription(lines) {
  const descriptionLines = getSectionLines(lines, "Beskrivning", ["Produktinfo"]);
  return descriptionLines.join("\n\n");
}

function getProductInfo(lines) {
  const rows = {};
  const productLines = getSectionLines(lines, "Produktinfo", Array.from(SECTION_ENDINGS));

  for (let i = 0; i < productLines.length; i += 1) {
    const label = productLines[i];
    if (!PRODUCT_LABELS.has(label)) continue;

    const values = [];
    for (let j = i + 1; j < productLines.length; j += 1) {
      const value = productLines[j];
      if (PRODUCT_LABELS.has(value)) break;
      if (SECTION_ENDINGS.has(value)) break;
      values.push(value);
    }

    if (values.length) rows[label] = values;
  }

  return rows;
}

function getContributors(productInfo, jsonLd) {
  const contributors = [];

  for (const name of getValues(productInfo["Författare"], jsonLd?.author)) {
    addContributor(contributors, name, "Author");
  }
  for (const name of getValues(productInfo["Uppläsare"])) {
    addContributor(contributors, name, "Narrator");
  }
  for (const name of getValues(productInfo["Illustratör"])) {
    addContributor(contributors, name, "Illustrator");
  }
  for (const name of getValues(productInfo["Formgivare"])) {
    addContributor(contributors, name, "Designer");
  }

  return contributors;
}

function getValues(primaryValues, fallbackValues = []) {
  const values = primaryValues?.length ? primaryValues : asArray(fallbackValues).map(getName);

  return values
    .flatMap((value) => cleanText(value).split(/\s*(?:,|;|\s+och\s+)\s+/i))
    .map((value) => cleanText(value))
    .filter(Boolean);
}

function getFormat(doc, lines, jsonLd) {
  const titleMatch = doc.title?.match(/\s-\s([^-|]+?)\s\(\d{10,13}\)\s\|/);
  if (titleMatch) return titleMatch[1];

  const knownFormats = [
    "Nedladdningsbar ljudbok",
    "Ljudbok",
    "E-bok",
    "Inbunden",
    "Pocket",
    "Storpocket",
    "Häftad",
    "Danskt band",
    "Kartonnage",
    "Klotband",
    "Flexband",
  ];
  const found = lines.find((line) => knownFormats.some((format) => line === format || line.startsWith(`${format},`)));
  if (found) return found.split(",")[0];

  return jsonLd?.bookFormat || "";
}

function normalizeEditionFormat(format) {
  const normalized = cleanText(format).toLowerCase();
  if (!normalized) return "";

  if (normalized.includes("ljudbok") || normalized.includes("audiobook")) return "Audiobook";
  if (normalized.includes("e-bok") || normalized.includes("ebook") || normalized.includes("e-book")) return "Ebook";
  if (normalized.includes("inbunden") || normalized.includes("hardcover")) return "Hardcover";
  if (normalized.includes("pocket") || normalized.includes("paperback") || normalized.includes("häftad")) return "Paperback";

  return cleanText(format);
}

function normalizeLanguage(language) {
  const value = cleanText(language);
  return LANGUAGE_MAP[value.toLowerCase()] || value;
}

function getCoverUrls(doc, title) {
  const urls = [];
  const metaImage = doc.querySelector?.("meta[property='og:image'], meta[name='twitter:image']")?.content;
  if (metaImage) urls.push(metaImage);

  for (const img of doc.querySelectorAll?.("img") || []) {
    const alt = cleanText(img.alt || img.title || "");
    if (title && alt && !alt.toLowerCase().includes(title.toLowerCase())) continue;

    const candidate = img.currentSrc || srcsetLargest(img.srcset) || img.src;
    if (candidate) urls.push(candidate);
  }

  return [...new Set(urls)];
}

function srcsetLargest(srcset) {
  if (!srcset) return "";

  return srcset
    .split(",")
    .map((item) => item.trim().split(/\s+/)[0])
    .filter(Boolean)
    .pop() || "";
}

function getBookJsonLd(doc) {
  for (const script of doc.querySelectorAll?.("script[type='application/ld+json']") || []) {
    try {
      const parsed = JSON.parse(script.textContent || "{}");
      const found = findBookLikeObject(parsed);
      if (found) return found;
    } catch {
      continue;
    }
  }

  return null;
}

function findBookLikeObject(value) {
  if (!value || typeof value !== "object") return null;
  if (Array.isArray(value)) {
    for (const item of value) {
      const found = findBookLikeObject(item);
      if (found) return found;
    }
    return null;
  }

  const types = asArray(value["@type"]).map((type) => String(type).toLowerCase());
  if (types.some((type) => ["book", "product"].includes(type)) && (value.isbn || value.name)) return value;

  for (const nested of Object.values(value)) {
    const found = findBookLikeObject(nested);
    if (found) return found;
  }

  return null;
}

function getSectionLines(lines, heading, endHeadings) {
  const start = lines.findIndex((line) => line === heading);
  if (start === -1) return [];

  const endings = new Set(endHeadings);
  const result = [];
  for (let i = start + 1; i < lines.length; i += 1) {
    const line = lines[i];
    if (endings.has(line)) break;
    result.push(line);
  }

  return result;
}

function getLines(doc) {
  const text = doc.body?.innerText || doc.body?.textContent || "";
  return text
    .split(/\r?\n/)
    .map((line) => cleanText(line))
    .filter(Boolean);
}

function firstValue(values) {
  return asArray(values).map((value) => cleanText(value)).find(Boolean) || "";
}

function getName(value) {
  if (!value) return "";
  if (typeof value === "string") return value;
  return value.name || value.label || "";
}

function getIsbnFromUrl(url) {
  return url.match(/(\d{10,13})(?:[/?#].*)?$/)?.[1] || "";
}

function cleanIsbn(isbn) {
  return cleanText(isbn).replace(/[^0-9X]/gi, "");
}

function cleanHtml(html) {
  if (!html) return "";
  const div = document.createElement("div");
  div.innerHTML = html;
  return cleanText(div.textContent || "");
}

function parseListeningLengthSeconds(value) {
  const text = cleanText(value);
  const hours = Number(text.match(/(\d+)\s*h/i)?.[1] || 0);
  const minutes = Number(text.match(/(\d+)\s*min/i)?.[1] || 0);
  const seconds = Number(text.match(/(\d+)\s*s(?:ek)?/i)?.[1] || 0);
  return (hours * 3600) + (minutes * 60) + seconds;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

export { adlibrisScraper, extractDetails };
