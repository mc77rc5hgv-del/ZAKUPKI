import http,{type IncomingMessage,type ServerResponse} from "node:http";
import fs from "node:fs/promises";
import path from "node:path";
import { assertOwner,assertRtsAccess,botConfig,rtsAccess } from "../../config/bot.js";
import { call } from "../../application/mcp-client.js";
import { addFavorite,addProfile,addWatch,dismissTrackedChange,loadStore,recordTrackedChange,removeFavorite,removeProfile,removeWatch,setPipeline,toggleWatch,user,type PipelineStage } from "../../infrastructure/persistence/bot-store.js";
import { createPairingCode,devicesForOwner,loadDeviceStore,publicDevice,redeemPairingCode,registerDevice,revokeDevice } from "../../infrastructure/persistence/device-store.js";
import { generateDeviceToken } from "../../infrastructure/security/pairing.js";
import { attachAgentHub,connectedDeviceId,disconnectDevice,isOwnerConnected,lastDisconnectReason } from "../../infrastructure/agent-hub/server.js";
import { validateTelegramInitData,type TelegramWebUser } from "./telegram-auth.js";

type RequestContext={user:TelegramWebUser;body:Record<string,any>};
const publicDir=path.resolve("public/miniapp");
const insidePublic=(target:string)=>target===publicDir||target.startsWith(`${publicDir}${path.sep}`);
const securityHeaders={"x-content-type-options":"nosniff","referrer-policy":"no-referrer","permissions-policy":"camera=(), microphone=(), geolocation=(), payment=(), usb=()","cross-origin-resource-policy":"same-origin","content-security-policy":"default-src 'self'; script-src 'self' https://telegram.org; style-src 'self'; img-src 'self' data: https:; connect-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'; frame-ancestors https://web.telegram.org https://*.telegram.org"};
const json=(res:ServerResponse,status:number,value:unknown)=>{const body=JSON.stringify(value);res.writeHead(status,{...securityHeaders,"content-type":"application/json; charset=utf-8","cache-control":"no-store"});res.end(body);};
const readBody=async(req:IncomingMessage)=>{const chunks:Buffer[]=[];let size=0;for await(const chunk of req){const buffer=Buffer.from(chunk);size+=buffer.length;if(size>1_000_000)throw new Error("Тело запроса превышает 1 МБ");chunks.push(buffer);}return chunks.length?JSON.parse(Buffer.concat(chunks).toString("utf8")):{};};
const mime:Record<string,string>={".html":"text/html; charset=utf-8",".css":"text/css; charset=utf-8",".js":"text/javascript; charset=utf-8",".svg":"image/svg+xml",".json":"application/json; charset=utf-8"};
async function serveStatic(req:IncomingMessage,res:ServerResponse){const pathname=new URL(req.url??"/","http://local").pathname;const relative=pathname==="/"?"index.html":pathname.replace(/^\//,"");const target=path.resolve(publicDir,relative);if(!insidePublic(target))return false;try{const data=await fs.readFile(target);res.writeHead(200,{...securityHeaders,"content-type":mime[path.extname(target)]??"application/octet-stream","cache-control":relative==="index.html"?"no-cache":"public, max-age=3600"});res.end(data);return true;}catch{return false;}}
function authenticate(req:IncomingMessage){
  if(botConfig.miniAppDevBypass&&["127.0.0.1","::1","::ffff:127.0.0.1","localhost"].includes(req.socket.remoteAddress??""))return {id:[...botConfig.allowedUsers][0]??1,first_name:"Development"};
  const auth=validateTelegramInitData(String(req.headers["x-telegram-init-data"]??""),botConfig.token,botConfig.telegramAuthMaxAgeSeconds);
  if(!botConfig.allowedUsers.has(auth.user.id))throw new Error("Пользователь не входит в список доступа");return auth.user;
}
const routes=new Map<string,(ctx:RequestContext)=>Promise<unknown>>([
  ["GET /api/connection",async ctx=>{const access=rtsAccess(ctx.user.id);const online=access.isOwner?isOwnerConnected(ctx.user.id):undefined;return {telegramVerified:true,accountOwner:access.isOwner,ownerConfigured:access.ownerConfigured,mode:botConfig.rtsTransport==="hub"?"agent":botConfig.rtsHeadless?"cloud":"local",cloudBlocked:access.cloudBlocked,agentOnline:online,deviceRevoked:access.isOwner&&!online?lastDisconnectReason(ctx.user.id)==="DEVICE_REVOKED":false,acceptsCredentials:false};}],
  ["POST /api/connection/open",async ctx=>{assertRtsAccess(ctx.user.id);const session=await call<any>("rts_session_status");return {opened:true,connected:Boolean(session.likelyLoggedIn&&!session.antiDdos),antiDdos:Boolean(session.antiDdos),headed:Boolean(session.headed)};}],
  ["POST /api/connection/check",async ctx=>{assertRtsAccess(ctx.user.id);const session=await call<any>("rts_session_status");return {connected:Boolean(session.likelyLoggedIn&&!session.antiDdos),antiDdos:Boolean(session.antiDdos),headed:Boolean(session.headed)};}],
  ["POST /api/connection/disconnect",async ctx=>{assertOwner(ctx.user.id);await call("rts_close");return {disconnected:true};}],
  ["POST /api/connection/forget",async ctx=>{assertOwner(ctx.user.id);if(ctx.body.confirm!==true)throw new Error("Требуется явное подтверждение удаления профиля");await call("rts_forget_profile");return {forgotten:true};}],
  ["POST /api/connection/devices/pair/start",async ctx=>{assertOwner(ctx.user.id);return createPairingCode(ctx.user.id);}],
  ["GET /api/connection/devices",async ctx=>{assertOwner(ctx.user.id);const activeDeviceId=connectedDeviceId(ctx.user.id);return devicesForOwner(ctx.user.id).map(d=>({...publicDevice(d),online:d.deviceId===activeDeviceId}));}],
  ["POST /api/connection/devices/revoke",async ctx=>{assertOwner(ctx.user.id);const deviceId=String(ctx.body.deviceId??"");const device=await revokeDevice(ctx.user.id,deviceId);if(!device)throw new Error("Устройство не найдено");disconnectDevice(deviceId);return {revoked:true};}],
  ["POST /api/search",ctx=>platform(ctx,"rts_search_advanced")],
  ["POST /api/deadlines",ctx=>platform(ctx,"rts_deadlines")],
  ["POST /api/native-filters",ctx=>platform(ctx,"rts_apply_site_filters")],
  ["POST /api/open",ctx=>platform(ctx,"rts_open")],
  ["POST /api/inspect",ctx=>platform(ctx,"rts_inspect_portal")],
  ["POST /api/request",ctx=>platform(ctx,"rts_get_request")],
  ["POST /api/dossier",ctx=>platform(ctx,"rts_build_dossier")],
  ["POST /api/readiness",ctx=>platform(ctx,"rts_assess_readiness")],
  ["POST /api/economics",ctx=>call("rts_bid_economics",ctx.body)],
  ["POST /api/workplan",ctx=>platform(ctx,"rts_build_workplan")],
  ["POST /api/track",async ctx=>{assertRtsAccess(ctx.user.id);const data=await call<any>("rts_track_request",ctx.body);const comparison=data?.tracking?.comparison;if(comparison?.changed)await recordTrackedChange(ctx.user.id,String(ctx.body.url??""),data.dossier?.title??String(ctx.body.url??""),comparison.changes??[]);return data;}],
  ["POST /api/tracked-changes/dismiss",async ctx=>{await dismissTrackedChange(ctx.user.id,String(ctx.body.url??""));return user(ctx.user.id).trackedChanges;}],
  ["POST /api/compare",ctx=>platform(ctx,"rts_compare_requests")],
  ["POST /api/draft",ctx=>platform(ctx,"rts_prepare_offer_draft",{...ctx.body,execute:false,confirm:false})],
  ["POST /api/tables",ctx=>platform(ctx,"rts_extract_tables")],
  ["POST /api/documents",ctx=>platform(ctx,"rts_download_all_documents")],
  ["POST /api/workspace",ctx=>platform(ctx,"rts_workspace")],
  ["POST /api/session",ctx=>platform(ctx,"rts_session_status")],
  ["POST /api/screenshot",ctx=>platform(ctx,"rts_screenshot")],
  ["POST /api/close",ctx=>platform(ctx,"rts_close")],
  ["GET /api/state",async ctx=>user(ctx.user.id)],
  ["POST /api/favorite",async ctx=>{ctx.body.action==="remove"?await removeFavorite(ctx.user.id,ctx.body.url):await addFavorite(ctx.user.id,ctx.body.url,ctx.body.title??ctx.body.url);return user(ctx.user.id).favorites;}],
  ["POST /api/pipeline",async ctx=>setPipeline(ctx.user.id,ctx.body.url,ctx.body.title??ctx.body.url,ctx.body.stage as PipelineStage,ctx.body.note,ctx.body.deadlineAt,ctx.body.assignee)],
  ["POST /api/profile",async ctx=>ctx.body.action==="remove"?(await removeProfile(ctx.user.id,ctx.body.id),user(ctx.user.id).profiles):addProfile(ctx.user.id,ctx.body.name,ctx.body.filter)],
  ["POST /api/watch",async ctx=>ctx.body.action==="remove"?(await removeWatch(ctx.user.id,ctx.body.id),user(ctx.user.id).watches):ctx.body.action==="toggle"?toggleWatch(ctx.user.id,ctx.body.id):addWatch(ctx.user.id,ctx.body.name,ctx.body.filter)],
]);

async function platform(ctx:RequestContext,tool:string,args:Record<string,unknown>=ctx.body){assertRtsAccess(ctx.user.id);return call(tool,args);}

// Pairing a new local agent proves ownership by possessing the one-time code
// shown in the Mini App, not by Telegram initData — the agent process is not a
// Telegram client. This is the only /api/connection route reachable without it.
const pairAttempts=new Map<string,number[]>();
function pairingRateLimited(ip:string,max=20,windowMs=5*60_000){const now=Date.now();const hits=(pairAttempts.get(ip)??[]).filter(t=>now-t<windowMs);hits.push(now);pairAttempts.set(ip,hits);return hits.length>max;}
async function handleDevicePair(req:IncomingMessage,res:ServerResponse){
  try{
    const ip=req.socket.remoteAddress??"unknown";
    if(pairingRateLimited(ip))return json(res,429,{ok:false,error:{code:"RATE_LIMITED",message:"Слишком много попыток сопряжения. Повторите позже.",retryable:true}});
    const body=await readBody(req);
    const code=typeof body.code==="string"?body.code:"";
    const deviceId=typeof body.deviceId==="string"?body.deviceId:"";
    if(!code||!deviceId||deviceId.length>128||code.length>64)return json(res,400,{ok:false,error:{code:"BAD_REQUEST",message:"Некорректные параметры сопряжения",retryable:false}});
    const redeemed=await redeemPairingCode(code);
    if(!redeemed)return json(res,400,{ok:false,error:{code:"PAIRING_CODE_INVALID",message:"Код сопряжения недействителен или истёк",retryable:false}});
    const token=generateDeviceToken();
    await registerDevice({deviceId,ownerTelegramId:redeemed.ownerTelegramId,token,displayName:typeof body.displayName==="string"?body.displayName:undefined,agentVersion:typeof body.agentVersion==="string"?body.agentVersion:undefined});
    return json(res,200,{ok:true,data:{deviceId,ownerTelegramId:redeemed.ownerTelegramId,accessToken:token}});
  }catch(error){console.error("device pairing failed",error instanceof Error?error.name:"Error");return json(res,400,{ok:false,error:{code:"PAIRING_FAILED",message:"Не удалось выполнить сопряжение",retryable:true}});}
}

function publicError(error:unknown){
  const message=error instanceof Error?error.message:String(error);
  if(/владелец|принадлежит другому|облачная авторизация/i.test(message))return message;
  if(/Telegram|подпись|список доступа|сессия Telegram/i.test(message))return message;
  if(/устройств|подтверждени/i.test(message))return message;
  // RtsError messages (network/timeout/circuit-breaker/queue) are pre-written,
  // static Russian text with no interpolated internals — safe to pass through.
  if(/РТС|браузер/i.test(message))return message;
  return "Операция не выполнена. Проверьте подключение к РТС и повторите попытку.";
}

export async function startWebServer(){
  await loadStore();
  await loadDeviceStore();
  const server=http.createServer(async(req,res)=>{try{
    const url=new URL(req.url??"/","http://local");if(url.pathname==="/health")return json(res,200,{ok:true,service:"zakupki-miniapp"});
    if(req.method==="POST"&&url.pathname==="/api/connection/devices/pair")return handleDevicePair(req,res);
    if(url.pathname.startsWith("/api/")){const user=authenticate(req);const handler=routes.get(`${req.method} ${url.pathname}`);if(!handler)return json(res,404,{error:"Маршрут не найден"});const body=req.method==="POST"?await readBody(req):{};return json(res,200,{ok:true,data:await handler({user,body})});}
    if(await serveStatic(req,res))return;json(res,404,{error:"Страница не найдена"});
  }catch(error){console.error("web request failed",req.method,new URL(req.url??"/","http://local").pathname,error instanceof Error?error.name:"Error");json(res,/доступ|подпись|Telegram|сессия|владелец|принадлежит|авторизация/i.test(String(error))?401:400,{ok:false,error:publicError(error)});}});
  attachAgentHub(server);
  await new Promise<void>((resolve,reject)=>{server.once("error",reject);server.listen(botConfig.webPort,"0.0.0.0",()=>resolve());});
  console.log(`Mini App listening on 0.0.0.0:${botConfig.webPort}`);return server;
}
