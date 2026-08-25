import http,{type IncomingMessage,type ServerResponse} from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { botConfig } from "../../config/bot.js";
import { call } from "../../application/mcp-client.js";
import { addFavorite,addProfile,addWatch,loadStore,removeFavorite,removeProfile,removeWatch,setPipeline,toggleWatch,user,type PipelineStage } from "../../infrastructure/persistence/bot-store.js";
import { validateTelegramInitData,type TelegramWebUser } from "./telegram-auth.js";

type RequestContext={user:TelegramWebUser;body:Record<string,any>};
const publicDir=path.resolve("public/miniapp");
const insidePublic=(target:string)=>target===publicDir||target.startsWith(`${publicDir}${path.sep}`);
const json=(res:ServerResponse,status:number,value:unknown)=>{const body=JSON.stringify(value);res.writeHead(status,{"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(body);};
const readBody=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>1_000_000)throw new Error("Тело запроса превышает 1 МБ");chunks.push(buffer);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};};
const mime:Record<string,string>={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".json":"application/json; charset=utf-8"};
async function serveStatic(req:IncomingMessage,res:ServerResponse){const pathname=new URL(req.url??"/","http://local").pathname;const relative=pathname==="/"?"index.html":pathname.replace(/^\//,"");const target=path.resolve(publicDir,relative);if(!insidePublic(target))return false;try{const data=await fs.readFile(target);res.writeHead(200,{"content-type":mime[path.extname(target)]??"application/octet-stream","cache-control":relative==="index.html"?"no-cache":"public, max-age=3600","x-content-type-options":"nosniff","content-security-policy":"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org"});res.end(data);return true;}catch{return false;}}
function authenticate(req:IncomingMessage){
  if(botConfig.miniAppDevBypass&&["127.0.0.1","::1","::ffff:127.0.0.1","localhost"].includes(req.socket.remoteAddress??""))return {id:[...botConfig.allowedUsers][0]??1,first_name:"Development"};
  const auth=validateTelegramInitData(String(req.headers["x-telegram-init-data"]??""),botConfig.token,botConfig.telegramAuthMaxAgeSeconds);
  if(!botConfig.allowedUsers.has(auth.user.id))throw new Error("Пользователь не входит в список доступа");return auth.user;
}
const routes=new Map<string,(ctx:RequestContext)=>Promise<unknown>>([
  ["POST /api/search",ctx=>call("rts_search_advanced",ctx.body)],
  ["POST /api/deadlines",ctx=>call("rts_deadlines",ctx.body)],
  ["POST /api/native-filters",ctx=>call("rts_apply_site_filters",ctx.body)],
  ["POST /api/open",ctx=>call("rts_open",ctx.body)],
  ["POST /api/inspect",ctx=>call("rts_inspect_portal",ctx.body)],
  ["POST /api/request",ctx=>call("rts_get_request",ctx.body)],
  ["POST /api/dossier",ctx=>call("rts_build_dossier",ctx.body)],
  ["POST /api/readiness",ctx=>call("rts_assess_readiness",ctx.body)],
  ["POST /api/economics",ctx=>call("rts_bid_economics",ctx.body)],
  ["POST /api/workplan",ctx=>call("rts_build_workplan",ctx.body)],
  ["POST /api/track",ctx=>call("rts_track_request",ctx.body)],
  ["POST /api/compare",ctx=>call("rts_compare_requests",ctx.body)],
  ["POST /api/draft",ctx=>call("rts_prepare_offer_draft",{...ctx.body,execute:false,confirm:false})],
  ["POST /api/tables",ctx=>call("rts_extract_tables",ctx.body)],
  ["POST /api/documents",ctx=>call("rts_download_all_documents",ctx.body)],
  ["POST /api/workspace",()=>call("rts_workspace")],
  ["POST /api/session",()=>call("rts_session_status")],
  ["POST /api/screenshot",ctx=>call("rts_screenshot",ctx.body)],
  ["POST /api/close",()=>call("rts_close")],
  ["GET /api/state",async ctx=>user(ctx.user.id)],
  ["POST /api/favorite",async ctx=>{ctx.body.action==="remove"?await removeFavorite(ctx.user.id,ctx.body.url):await addFavorite(ctx.user.id,ctx.body.url,ctx.body.title??ctx.body.url);return user(ctx.user.id).favorites;}],
  ["POST /api/pipeline",async ctx=>setPipeline(ctx.user.id,ctx.body.url,ctx.body.title??ctx.body.url,ctx.body.stage as PipelineStage,ctx.body.note,ctx.body.deadlineAt)],
  ["POST /api/profile",async ctx=>ctx.body.action==="remove"?(await removeProfile(ctx.user.id,ctx.body.id),user(ctx.user.id).profiles):addProfile(ctx.user.id,ctx.body.name,ctx.body.filter)],
  ["POST /api/watch",async ctx=>ctx.body.action==="remove"?(await removeWatch(ctx.user.id,ctx.body.id),user(ctx.user.id).watches):ctx.body.action==="toggle"?toggleWatch(ctx.user.id,ctx.body.id):addWatch(ctx.user.id,ctx.body.name,ctx.body.filter)],
]);

export async function startWebServer(){
  await loadStore();
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url??"/","http://local");if(url.pathname==="/health")return json(res,200,{ok:true,service:"zakupki-miniapp"});
    if(url.pathname.startsWith("/api/")){const user=authenticate(req);const handler=routes.get(`${req.method} ${url.pathname}`);if(!handler)return json(res,404,{error:"Маршрут не найден"});const body=req.method==="POST"?await readBody(req):{};return json(res,200,{ok:true,data:await handler({user,body})});}
    if(await serveStatic(req,res))return;json(res,404,{error:"Страница не найдена"});
  }catch(error){json(res,/доступ|подпись|Telegram|сессия/i.test(String(error))?401:400,{ok:false,error:error instanceof Error?error.message:String(error)});}});
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(botConfig.webPort,"0.0.0.0",()=>resolve());});
  console.log(`Mini App listening on 0.0.0.0:${botConfig.webPort}`);return server;
}
