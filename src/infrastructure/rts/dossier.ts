import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";
import type { Page } from "playwright";
import { analyzeDeterministic, normalizeTender } from "../../domain/procurement.js";
import { compareDossiers, fingerprintDossier, type TenderDossier } from "../../domain/dossier.js";
import { config, portalUrl } from "./config.js";
import { inspectPortal } from "./inventory.js";
import { visibleSnapshot } from "./extract.js";

export async function buildDossier(page:Page):Promise<TenderDossier>{
  const snap=await visibleSnapshot(page);const inventory=await inspectPortal(page);const url=portalUrl(page.url());const title=await page.title();
  const documents=inventory.controls.filter(x=>x.kind==="link"&&x.href&&/download|document|file|attachment|\.pdf|\.docx?|\.xlsx?|\.zip/i.test(`${x.href} ${x.label}`)).map(x=>({name:x.label||"document",url:x.href!}));
  const tender=normalizeTender({title,url,summary:snap.text});const analysis=analyzeDeterministic(tender);
  const base={url,title,text:snap.text,tender,analysis,documents,tables:inventory.tables.map(x=>({headers:x.headers,rows:x.rows})),capabilities:inventory.capabilities};
  return {...base,capturedAt:new Date().toISOString(),fingerprint:fingerprintDossier(base)};
}
const snapshotFile=(url:string)=>path.join(config.snapshotDir,`${createHash("sha256").update(url).digest("hex")}.json`);
export async function trackDossier(dossier:TenderDossier){
  await fs.mkdir(config.snapshotDir,{recursive:true,mode:0o700});const file=snapshotFile(dossier.url);let before:TenderDossier|null=null;
  try{before=JSON.parse(await fs.readFile(file,"utf8")) as TenderDossier;}catch{before=null;}
  const temp=`${file}.${process.pid}.${randomUUID()}.tmp`;await fs.writeFile(temp,JSON.stringify(dossier,null,2),{encoding:"utf8",mode:0o600});await fs.rename(temp,file);await fs.chmod(file,0o600).catch(()=>{});
  return {file,firstCapture:!before,comparison:before?compareDossiers(before,dossier):null};
}
