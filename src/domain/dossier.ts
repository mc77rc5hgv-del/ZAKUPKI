import { createHash } from "node:crypto";
import type { Tender } from "./procurement.js";
import type { PortalCapability } from "./portal-capabilities.js";

export type DossierDocument={name:string;url:string};
export type TenderDossier={url:string;title:string;capturedAt:string;text:string;tender:Tender;analysis:unknown;documents:DossierDocument[];tables:Array<{headers:string[];rows:string[][]}>;capabilities:PortalCapability[];fingerprint:string};
const canonical=(value:unknown):unknown=>Array.isArray(value)?value.map(canonical):value&&typeof value==="object"?Object.fromEntries(Object.entries(value as Record<string,unknown>).sort(([a],[b])=>a.localeCompare(b)).map(([k,v])=>[k,canonical(v)])):value;
const stable=(value:unknown)=>JSON.stringify(canonical(value));
export function fingerprintDossier(value:Omit<TenderDossier,"capturedAt"|"fingerprint">){return createHash("sha256").update(stable({title:value.title,text:value.text,tender:value.tender,documents:value.documents,tables:value.tables})).digest("hex");}
export function compareDossiers(before:TenderDossier,after:TenderDossier){
  const changes:Array<{field:string;before:unknown;after:unknown;severity:"info"|"warning"|"critical"}>=[];
  const fields:Array<keyof Tender>=["price","deadlineAt","status","customer","location","hasDocuments"];
  for(const field of fields)if(before.tender[field]!==after.tender[field])changes.push({field:String(field),before:before.tender[field],after:after.tender[field],severity:field==="deadlineAt"||field==="price"?"critical":"warning"});
  if(before.documents.length!==after.documents.length)changes.push({field:"documents",before:before.documents.length,after:after.documents.length,severity:"warning"});
  if(before.fingerprint!==after.fingerprint&&!changes.length)changes.push({field:"content",before:before.fingerprint,after:after.fingerprint,severity:"info"});
  return {changed:before.fingerprint!==after.fingerprint,changes,beforeFingerprint:before.fingerprint,afterFingerprint:after.fingerprint};
}
