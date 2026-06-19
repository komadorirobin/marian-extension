import { Extractor } from "./AbstractExtractor.js";
import {
  addContributor,
  addMapping,
  cleanText,
  collectObject,
  fetchBackground,
  getCoverData,
  normalizeReadingFormat,
} from "../shared/utils.js";

const LIBRIS_PATTERNS = [
  /^https?:\/\/libris\.kb\.se\/bib\/([0-9a-z]+)(?:[/?#].*)?$/i,
  /^https?:\/\/libris\.kb\.se\/(?:en|katalogisering)\/([0-9a-z]{6,})(?:[/?#].*)?$/i,
  /^https?:\/\/libris\.kb\.se\/([0-9a-z]{6,})(?:[/?#].*)?$/i,
];

const LANGUAGE_MAP = {
  afr: "Afrikaans",
  ara: "Arabic",
  chi: "Chinese",
  dan: "Danish",
  dut: "Dutch",
  eng: "English",
  fin: "Finnish",
  fre: "French",
  ger: "German",
  gre: "Greek",
  ita: "Italian",
  jpn: "Japanese",
  lat: "Latin",
  nor: "Norwegian",
  pol: "Polish",
  por: "Portuguese",
  rus: "Russian",
  spa: "Spanish",
  swe: "Swedish",
};

const COUNTRY_MAP = {
  dk: "Denmark",
  enk: "England",
  fi: "Finland",
  fr: "France",
  gw: "Germany",
  it: "Italy",
  ne: "Netherlands",
  no: "Norway",
  nyu: "United States",
  pl: "Poland",
  sp: "Spain",
  stk: "Scotland",
  sw: "Sweden",
  xxk: "United Kingdom",
  xxu: "United States",
};

const ROLE_MAP = {
  actor: "Actor",
  adapter: "Adapter",
  afterword: "Afterword",
  artist: "Artist",
  author: "Author",
  authorofafterwordcolophonetc: "Afterword",
  authorofintroduction: "Introduction",
  authorofintroductionetc: "Introduction",
  compiler: "Compiler",
  contributor: "Contributor",
  creator: "Author",
  editor: "Editor",
  illustrator: "Illustrator",
  narrator: "Narrator",
  photographer: "Photographer",
  translator: "Translator",
  writerofpreface: "Preface",
};

class librisScraper extends Extractor {
  get _name() { return "Libris Extractor"; }
  needsReload = false;

  _sitePatterns = LIBRIS_PATTERNS;

  async getDetails() {
    return getLibrisDetails(document.location.href);
  }

  normalizeUrl(url) {
    return normalizeLibrisRecordUrl(url) || super.normalizeUrl(url);
  }
}

async function getLibrisDetails(url) {
  const { record, entity, graph } = await getLibrisRecordContext(url);
  return getDetailsFromContext(record, entity, graph);
}

async function getLibrisDetailsByIsbn(isbn) {
  const recordUrl = await findLibrisRecordUrlByIsbn(isbn);
  if (!recordUrl) throw new Error("No Libris record found for ISBN");
  return getLibrisDetails(recordUrl);
}

async function getLibrisDetailsWithPhysicalByIsbn(isbn) {
  const recordUrl = await findLibrisRecordUrlByIsbn(isbn);
  if (!recordUrl) throw new Error("No Libris record found for ISBN");

  const context = await getLibrisRecordContext(recordUrl);
  const details = await getDetailsFromContext(context.record, context.entity, context.graph);
  const physical = await getRelatedPhysicalDetails(context);

  return {
    details,
    physicalDetails: physical?.details || null,
    physicalRecordUrl: physical?.recordUrl || "",
    physicalError: physical ? "" : getPhysicalLookupError(context.entity, context.graph),
  };
}

async function findLibrisRecordUrlByIsbn(isbn) {
  const cleanIsbn = String(isbn || "").replace(/[^0-9X]/gi, "");
  if (!cleanIsbn) return "";

  const searchUrl = `https://libris.kb.se/find?q=isbn:${encodeURIComponent(cleanIsbn)}&_limit=20`;
  const data = await fetchLibrisJson(searchUrl);
  const items = asArray(data?.items);

  const exact = items.find((item) => itemMatchesIsbn(item, cleanIsbn));
  const item = exact || items[0];
  return getRecordUrlFromFindItem(item);
}

function normalizeLibrisRecordUrl(url) {
  try {
    const parsed = new URL(url);
    if (parsed.hostname !== "libris.kb.se") return "";

    for (const pattern of LIBRIS_PATTERNS) {
      const match = url.match(pattern);
      if (!match) continue;

      const id = match[1];
      if (parsed.pathname.startsWith("/bib/") && !/[a-z]/i.test(id)) return `https://libris.kb.se/bib/${id}`;
      return `https://libris.kb.se/${id}`;
    }
  } catch {
    return "";
  }

  return "";
}

async function fetchLibrisJson(recordUrl) {
  const headers = { Accept: "application/ld+json, application/json;q=0.9" };

  let response;
  try {
    response = await fetch(recordUrl, { headers });
  } catch {
    const text = await fetchBackground(recordUrl, { headers });
    return JSON.parse(text);
  }

  if (!response.ok) {
    throw new Error(`Libris API error: ${response.status}`);
  }

  try {
    return await response.json();
  } catch (error) {
    throw new Error(`Libris response was not JSON-LD: ${error.message}`);
  }
}

function itemMatchesIsbn(item, isbn) {
  const identifiers = [
    ...asArray(item?.identifiedBy),
    ...asArray(item?.itemOf?.identifiedBy),
    ...asArray(item?.itemOf?.indirectlyIdentifiedBy),
  ];

  return identifiers.some((identifier) => {
    const value = String(identifier?.value || "").replace(/[^0-9X]/gi, "");
    return value === isbn;
  });
}

function getRecordUrlFromFindItem(item) {
  const candidates = [
    item?.itemOf?.meta?.["@id"],
    item?.itemOf?.["@id"],
    item?.meta?.["@id"],
    item?.["@id"],
  ];

  const candidate = candidates.find(Boolean);
  if (!candidate) return "";
  return String(candidate).replace(/#.*$/, "");
}

async function getLibrisRecordContext(url) {
  const recordUrl = normalizeLibrisRecordUrl(url);
  if (!recordUrl) throw new Error("Invalid Libris record URL");

  const data = await fetchLibrisJson(recordUrl);
  const topLevelGraph = asArray(data?.["@graph"]);
  const graph = collectGraphNodes(data);

  const record = topLevelGraph.find(isRecordWithMainEntity)
    || graph.find(isRecordWithMainEntity);
  if (!record) throw new Error("No Libris record found");

  const entity = findNode(graph, record.mainEntity?.["@id"])
    || graph.find((node) => hasId(node) && resourceKey(node["@id"]) === resourceKey(record["@id"]) && !isType(node, "Record"));
  if (!entity) throw new Error("No Libris record entity found");

  return { record, entity, graph };
}

async function getDetailsFromContext(record, entity, graph) {
  const details = extractDetails(record, entity, graph);
  const coverData = getCoverData(getImageUrls(entity));

  return collectObject([coverData, details]);
}

async function getRelatedPhysicalDetails({ entity, graph }) {
  const physicalEntity = findRelatedPhysicalEntity(entity, graph);
  if (!physicalEntity) return null;

  const record = findRecordForEntity(graph, physicalEntity) || {
    "@id": recordUrlFromEntity(physicalEntity),
    mainEntity: { "@id": physicalEntity["@id"] },
  };

  const details = await getDetailsFromContext(record, physicalEntity, graph);
  return { details, recordUrl: recordUrlFromEntity(physicalEntity) };
}

function findRelatedPhysicalEntity(entity, graph) {
  const workKey = resourceKey(entity?.instanceOf?.["@id"]);
  if (!workKey) return null;

  const currentKey = resourceKey(entity?.["@id"]);
  const candidates = graph
    .filter((node) => {
      if (!hasId(node) || isType(node, "Record")) return false;
      if (resourceKey(node["@id"]) === currentKey) return false;
      if (resourceKey(node.instanceOf?.["@id"]) !== workKey) return false;
      if (!getPages(node)) return false;
      return isPhysicalEntity(node);
    })
    .sort((a, b) => physicalCandidateScore(b) - physicalCandidateScore(a));

  return candidates[0] || null;
}

function findRecordForEntity(graph, entity) {
  const entityKey = resourceKey(entity?.["@id"]);
  return graph.find((node) => isRecordWithMainEntity(node) && resourceKey(node.mainEntity?.["@id"]) === entityKey) || null;
}

function recordUrlFromEntity(entity) {
  return String(entity?.["@id"] || "").replace(/#.*$/, "");
}

function isPhysicalEntity(entity) {
  const format = getEditionFormat(entity);
  return !!format && normalizeReadingFormat(format) === "Physical Book" && !isDigitalEntity(entity) && !isAudioEntity(entity);
}

function isDigitalEntity(entity) {
  const haystack = getEntityFormatHaystack(entity);
  return /(digitalresource|onlineresource|online resource|ebook|e-book|electronic|digital)/i.test(haystack);
}

function isAudioEntity(entity) {
  const haystack = getEntityFormatHaystack(entity);
  return /(audio|audiobook|sound|spoken|cd|mp3|daisy|ljudbok)/i.test(haystack);
}

function physicalCandidateScore(entity) {
  const haystack = getEntityFormatHaystack(entity);
  let score = 0;

  if (/(hardcover|hardback|inbunden|halvklotband|klotband|kartonnage)/i.test(haystack)) score += 50;
  if (/(physicalresource|volume|print)/i.test(haystack)) score += 40;
  if (/(paperback|softcover|h\u00e4ftad|mjukband)/i.test(haystack)) score += 30;
  if (getPages(entity)) score += 20;
  if (asArray(entity.identifiedBy).some((item) => getTypes(item).includes("ISBN"))) score += 10;

  return score;
}

function getPhysicalLookupError(entity, graph) {
  if (!isDigitalEntity(entity)) return "";

  const workKey = resourceKey(entity?.instanceOf?.["@id"]);
  const hasPhysicalCandidate = graph.some((node) => {
    if (!hasId(node) || isType(node, "Record")) return false;
    return resourceKey(node.instanceOf?.["@id"]) === workKey && isPhysicalEntity(node);
  });

  return hasPhysicalCandidate
    ? "No related physical Libris edition with page count found."
    : "No related physical Libris edition found.";
}

function extractDetails(record, entity, graph) {
  const details = {};
  const mappings = {};

  addRecordMappings(mappings, record);
  addIdentifiers(details, mappings, entity);

  const title = getTitle(entity);
  if (title) details.Title = title;

  const description = getSummary(entity);
  if (description) details.Description = description;

  const publisher = getPublisher(entity);
  if (publisher) details.Publisher = publisher;

  const publicationDate = getPublicationDate(entity);
  if (publicationDate) details["Publication date"] = publicationDate;

  const country = getCountry(entity);
  if (country) details.Country = country;

  const editionStatement = cleanBrackets(firstLabel(entity.editionStatement));
  if (editionStatement) details["Edition Information"] = editionStatement;

  const pages = getPages(entity);
  if (pages) details.Pages = pages;

  const format = getEditionFormat(entity);
  if (format) {
    details["Edition Format"] = format;
    details["Reading Format"] = normalizeReadingFormat(format);
  }

  const listeningLength = getListeningLength(entity);
  if (listeningLength) {
    details["Listening Length"] = listeningLength.label;
    details["Listening Length Seconds"] = listeningLength.seconds;
  }

  const language = getLanguage(entity, graph);
  if (language) details.Language = language;

  const contributors = getContributors(entity, graph);
  if (contributors.length) details.Contributors = contributors;

  const series = getSeries(entity, graph);
  Object.assign(details, series);

  if (Object.keys(mappings).length) details.Mappings = mappings;

  return details;
}

function addRecordMappings(mappings, record) {
  if (record.controlNumber) addMapping(mappings, "Libris", cleanText(record.controlNumber));
  if (record["@id"]) addMapping(mappings, "Libris URI", record["@id"]);
}

function addIdentifiers(details, mappings, entity) {
  for (const identifier of asArray(entity.identifiedBy)) {
    const types = getTypes(identifier);
    const value = cleanText(identifier?.value || "");
    if (!value) continue;

    if (types.includes("ISBN")) {
      const compact = value.replace(/[^0-9X]/gi, "");
      if (compact.length === 13 && !details["ISBN-13"]) {
        details["ISBN-13"] = value;
      } else if (compact.length === 10 && !details["ISBN-10"]) {
        details["ISBN-10"] = value;
      }
      continue;
    }

    if (types.includes("DOI")) {
      addMapping(mappings, "DOI", value);
      continue;
    }

    if (types.includes("SystemNumber")) {
      addMapping(mappings, "Libris System Number", value);
    }
  }
}

function getTitle(entity) {
  const title = asArray(entity.hasTitle).find((item) => isType(item, "Title"))
    || asArray(entity.hasTitle)[0];
  if (!title) return "";

  const mainTitle = firstLabel(title.mainTitle || title.label || title.name);
  const subtitle = firstLabel(title.subtitle || title.titleRemainder);

  if (mainTitle && subtitle) return cleanText(`${mainTitle}: ${subtitle}`);
  return cleanText(mainTitle || subtitle);
}

function getSummary(entity) {
  const parts = asArray(entity.summary)
    .map((item) => firstLabel(item?.label || item))
    .filter(Boolean);

  return parts.map(cleanText).filter(Boolean).join("\n\n");
}

function getPublisher(entity) {
  for (const publication of asArray(entity.publication)) {
    const direct = firstLabel(publication?.agent);
    if (direct) return cleanPublisher(direct);

    for (const part of asArray(publication?.hasPart)) {
      const nested = firstLabel(part?.agent);
      if (nested) return cleanPublisher(nested);
    }
  }

  return "";
}

function cleanPublisher(value) {
  return cleanText(value).replace(/^Imprint:\s*/i, "");
}

function getPublicationDate(entity) {
  const publication = asArray(entity.publication)[0];
  if (!publication) return "";

  return cleanBrackets(firstLabel(publication.date) || firstLabel(publication.year));
}

function getCountry(entity) {
  for (const publication of asArray(entity.publication)) {
    for (const country of asArray(publication?.country)) {
      const code = lastIdPart(country?.["@id"]);
      if (code && COUNTRY_MAP[code]) return COUNTRY_MAP[code];
      const label = firstLabel(country);
      if (label) return label;
    }
  }

  return "";
}

function getPages(entity) {
  const extent = getExtentText(entity);
  const matches = [...extent.matchAll(/\b(\d+)\s*(?:pages?|p\.?|sidor|s\.)(?=[\s).,;]|$)/gi)];
  if (!matches.length) return "";

  return matches[matches.length - 1][1];
}

function getListeningLength(entity) {
  const extent = getExtentText(entity);
  const hours = firstNumber(extent, /\b(\d+)\s*(?:hours?|hrs?|h|tim\.?|timmar)(?=[\s).,;]|$)/i);
  const minutes = firstNumber(extent, /\b(\d+)\s*(?:minutes?|mins?|min\.?)(?=[\s).,;]|$)/i);
  const seconds = firstNumber(extent, /\b(\d+)\s*(?:seconds?|secs?|sek\.?)(?=[\s).,;]|$)/i);

  if (!hours && !minutes && !seconds) return null;

  const totalSeconds = (hours * 3600) + (minutes * 60) + seconds;
  const label = [
    hours ? `${hours} hours` : "",
    minutes ? `${minutes} minutes` : "",
    seconds ? `${seconds} seconds` : "",
  ].filter(Boolean).join(" ");

  return { label, seconds: totalSeconds };
}

function getEditionFormat(entity) {
  const haystack = getEntityFormatHaystack(entity);

  if (/(audio|audiobook|sound|spoken|cd|mp3|daisy|ljudbok)/i.test(haystack)) return "Audiobook";
  if (/(digitalresource|onlineresource|online resource|ebook|e-book|electronic|digital)/i.test(haystack)) return "Digital";
  if (/(paperback|softcover|h\u00e4ftad|mjukband)/i.test(haystack)) return "Paperback";
  if (/(hardcover|hardback|inbunden|halvklotband|klotband|kartonnage)/i.test(haystack)) return "Hardcover";
  if (/(physicalresource|volume|print)/i.test(haystack)) return "Print";

  return "";
}

function getEntityFormatHaystack(entity) {
  return [
    ...getTypes(entity),
    ...asArray(entity.category).map((item) => item?.["@id"] || firstLabel(item)),
    ...asArray(entity.identifiedBy).flatMap((item) => asArray(item?.qualifier).map(firstLabel)),
    firstLabel(entity.editionStatement),
    getExtentText(entity),
  ].join(" ").toLowerCase();
}

function getLanguage(entity, graph) {
  const language = asArray(entity.instanceOf?.language)[0];
  if (!language) return "";

  const code = lastIdPart(language["@id"]);
  if (code && LANGUAGE_MAP[code]) return LANGUAGE_MAP[code];

  const node = findNode(graph, language["@id"]);
  return firstLabel(node?.prefLabel || node?.label || language);
}

function getContributors(entity, graph) {
  const contributors = [];
  const contributions = [
    ...asArray(entity.instanceOf?.contribution),
    ...asArray(entity.contribution),
  ];

  for (const contribution of contributions) {
    const name = getAgentName(contribution?.agent, graph);
    if (!name) continue;

    const roles = getRoles(contribution);
    addContributor(contributors, name, roles.length ? roles : "Contributor");
  }

  return contributors;
}

function getRoles(contribution) {
  const roles = asArray(contribution?.role)
    .map((role) => {
      const label = firstLabel(role?.label || role?.prefLabel || role?.name);
      if (label) return cleanRole(label);

      const key = lastIdPart(role?.["@id"] || role);
      return cleanRole(key);
    })
    .filter(Boolean);

  if (!roles.length && isType(contribution, "PrimaryContribution")) return ["Author"];
  return [...new Set(roles)];
}

function cleanRole(role) {
  const key = cleanText(role)
    .replace(/^.*\//, "")
    .replace(/[^a-z0-9]+/gi, "")
    .toLowerCase();

  if (!key) return "";
  if (ROLE_MAP[key]) return ROLE_MAP[key];
  return key.charAt(0).toUpperCase() + key.slice(1);
}

function getAgentName(agent, graph) {
  const resolved = resolveNode(agent, graph);
  if (!resolved) return "";

  const givenName = firstLabel(resolved.givenName);
  const familyName = firstLabel(resolved.familyName);
  if (givenName || familyName) return cleanText([givenName, familyName].filter(Boolean).join(" "));

  return firstLabel(resolved.name || resolved.label || resolved.prefLabel);
}

function getSeries(entity, graph) {
  const seriesMembership = asArray(entity.seriesMembership)[0];
  if (!seriesMembership) return {};

  const series = resolveNode(seriesMembership.inSeries, graph) || seriesMembership.inSeries;
  const title = getTitle(series?.instanceOf || series) || firstLabel(seriesMembership.seriesStatement);
  const place = firstLabel(seriesMembership.seriesEnumeration || seriesMembership.seriesNumber);

  return collectPlainObject({
    Series: title,
    "Series Place": place,
  });
}

function getImageUrls(entity) {
  return [
    ...asArray(entity.image),
    ...asArray(entity.associatedMedia),
  ]
    .map((item) => item?.["@id"] || item?.url || firstLabel(item))
    .filter(Boolean);
}

function getExtentText(entity) {
  return asArray(entity.extent)
    .map((item) => firstLabel(item?.label || item))
    .filter(Boolean)
    .join(" ");
}

function collectGraphNodes(data) {
  const nodes = [];
  const stack = [...asArray(data?.["@graph"] || data)];

  while (stack.length) {
    const node = stack.shift();
    if (!node || typeof node !== "object") continue;

    if (node["@id"] || node["@type"]) nodes.push(node);
    if (node["@graph"]) stack.push(...asArray(node["@graph"]));
  }

  return nodes;
}

function findNode(graph, id) {
  if (!id) return null;
  const exact = graph.find((node) => node?.["@id"] === id);
  if (exact) return exact;

  const key = resourceKey(id);
  return graph.find((node) => resourceKey(node?.["@id"]) === key) || null;
}

function resolveNode(value, graph) {
  if (!value || typeof value !== "object") return null;
  if (value["@id"]) return findNode(graph, value["@id"]) || value;
  return value;
}

function isRecordWithMainEntity(node) {
  return isType(node, "Record") && !!node?.mainEntity?.["@id"];
}

function isType(node, type) {
  return getTypes(node).includes(type);
}

function getTypes(node) {
  return asArray(node?.["@type"]).filter(Boolean);
}

function hasId(node) {
  return !!node?.["@id"];
}

function resourceKey(id) {
  if (!id) return "";
  try {
    const parsed = new URL(id);
    return `${parsed.origin}${parsed.pathname}`;
  } catch {
    return String(id).split(/[?#]/)[0];
  }
}

function lastIdPart(id) {
  if (!id) return "";
  const value = String(id).replace(/[#?].*$/, "");
  return value.split("/").filter(Boolean).pop() || "";
}

function firstLabel(value) {
  if (value == null) return "";
  if (Array.isArray(value)) return firstLabel(value.find((item) => firstLabel(item)) || "");
  if (typeof value === "string" || typeof value === "number") return cleanText(String(value));
  if (typeof value !== "object") return "";

  return firstLabel(value.label)
    || firstLabel(value.prefLabel)
    || firstLabel(value.value)
    || firstLabel(value.name);
}

function cleanBrackets(value) {
  return cleanText(value).replace(/^\[(.*)\]$/, "$1");
}

function firstNumber(text, regex) {
  const match = cleanText(text).match(regex);
  return match ? Number(match[1]) : 0;
}

function asArray(value) {
  if (value == null) return [];
  return Array.isArray(value) ? value : [value];
}

function collectPlainObject(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value != null && value !== "")
  );
}

export {
  librisScraper,
  getLibrisDetails,
  getLibrisDetailsByIsbn,
  getLibrisDetailsWithPhysicalByIsbn,
  findLibrisRecordUrlByIsbn,
};
