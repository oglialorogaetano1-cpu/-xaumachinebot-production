"use client";

import { FormEvent, useCallback, useEffect, useMemo, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity, BarChart3, BellRing, Bot, Building2, ChartNoAxesCombined, CircleDollarSign,
  ChevronLeft, CreditCard, FileText, Gauge, Languages, LayoutDashboard, LogOut, Menu,
  MessageCircle, Plug, Search, Settings, ShieldCheck, Sparkles, Users, Workflow, X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { demoCampaigns, demoConversations, demoLeads } from "@/lib/demo";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type Lead = { id: string; full_name: string | null; username?: string | null; telegram_chat_id?: number | null; language: string; status: string; first_source: string; deposit_total: number; rebate_total: number; puprime_status: string; created_at?:string };
type Campaign = { id: string; name: string; language: string; source_channel: string | null; deep_link_code: string | null; active: boolean };
type AdSpend = { id: string; campaign_id: string | null; channel: string; language: string | null; amount: number; period_start: string | null; period_end: string | null };
type Tenant = { id: string; slug: string; name: string; status: string; plan_code: string; role?: string };
type TenantBot = { id: string; name: string; username: string | null; mode: string; status: string; admin_chat_id: string | null; default_language: string; last_tested_at: string | null; last_error: string | null };
type DemoConversation = (typeof demoConversations)[number];
type ConversationRow = { id:string; lead_id:string; channel:string; status:string; last_message_at:string|null };
type MessageRow = { id:string; conversation_id:string; direction:string; sender_type:string; body:string|null; created_at:string };
type ChatMessage = { id:string; side:"lead"|"ai"; sender:string; text:string; time:string; createdAt:string };
type LiveChat = { id:string; leadId:string; name:string; username:string|null; language:string; stage:string; time:string; unread:number; messages:ChatMessage[] };
type FollowupRuleRow = { id:string; name:string; trigger_event:string; lead_status:string|null; delay_minutes:number; channel:string; message_template:string; stop_on_reply:boolean; enabled:boolean };
type HandoffRow = { id:string; lead_id:string; conversation_id:string|null; reason:string; priority:string; requested_channel:string; status:string; assigned_to:string|null; created_at:string };
type UploadRow = { id:string; kind:string; name:string; mime_type:string|null; size_bytes:number|null; processing_status:string; created_at:string };
type Locale = "it"|"en";
type PageKey = "vision"|"dashboard"|"leads"|"conversations"|"followups"|"handoffs"|"campaigns"|"puprime"|"economics"|"prompt"|"materials"|"integrations"|"bots"|"tenants"|"billing"|"settings";
const SIGNAL_ROOM_URL="https://t.me/+-e1_tDFps0Q2YmE0";

const nav: Array<{ key: PageKey; label: string; icon: typeof Gauge }> = [
  { key:"vision", label:"B2B Vision Demo", icon:Gauge },
  { key:"dashboard", label:"Panoramica", icon:LayoutDashboard }, { key:"leads", label:"Lead e pipeline", icon:Users },
  { key:"conversations", label:"Conversazioni", icon:MessageCircle }, { key:"followups", label:"Follow-up", icon:Workflow },
  { key:"handoffs", label:"Intervento umano", icon:BellRing }, { key:"campaigns", label:"Campagne e lingue", icon:Languages },
  { key:"puprime", label:"PU Prime", icon:ShieldCheck },
  { key:"economics", label:"Costi, CPA e rebate", icon:CircleDollarSign }, { key:"prompt", label:"Prompt AI", icon:Sparkles },
  { key:"materials", label:"Materiali e guide", icon:FileText }, { key:"integrations", label:"Integrazioni", icon:Plug },
  { key:"bots", label:"Bot white label", icon:Bot },
  { key:"tenants", label:"Clienti CRM", icon:Building2 }, { key:"billing", label:"Piani e licenze", icon:CreditCard },
  { key:"settings", label:"Impostazioni", icon:Settings },
];

const englishNav:Partial<Record<PageKey,string>>={vision:"B2B Vision Demo",dashboard:"Overview",leads:"Leads & pipeline",conversations:"Conversations",followups:"Follow-ups",handoffs:"Human support",campaigns:"Campaigns & languages",puprime:"PU Prime",economics:"Costs, CPA & rebates",prompt:"AI Prompt",materials:"Materials & guides",integrations:"Integrations",bots:"White-label bots",tenants:"CRM clients",billing:"Plans & licences",settings:"Settings"};

const eur = new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR", maximumFractionDigits:0 });

export default function CrmApp() {
  const params = useSearchParams();
  const locale:Locale=params.get("lang")==="en"?"en":"it";
  const [demo, setDemo] = useState(params.get("demo") === "1");
  const [session, setSession] = useState<Session | null>(null);
  const [passwordRecovery, setPasswordRecovery] = useState(false);
  const [authReady, setAuthReady] = useState(false);
  const [page, setPage] = useState<PageKey>(params.get("demo") === "1" ? "vision" : "dashboard");
  const [menu, setMenu] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(demo ? { id:"00000000-0000-4000-8000-000000000002", slug:"demo", name:"XAU Machine Demo", status:"demo", plan_code:"demo", role:"viewer" } : null);
  const [leads, setLeads] = useState<Lead[]>(demoLeads as Lead[]);
  const [campaigns, setCampaigns] = useState<Campaign[]>(demoCampaigns as Campaign[]);
  const [bots, setBots] = useState<TenantBot[]>(demo ? [{id:"demo-bot",name:"Demo Trading",username:"@DemoTradingBot",mode:"white_label",status:"active",admin_chat_id:null,default_language:"it",last_tested_at:null,last_error:null}] : []);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const supabase = getSupabase();
    if (!supabase) { setAuthReady(true); return; }
    supabase.auth.getSession().then((result: { data: { session: Session | null } }) => { setSession(result.data.session); setAuthReady(true); });
    const { data: listener } = supabase.auth.onAuthStateChange((event: AuthChangeEvent, value: Session | null) => { setSession(value); if(event==="PASSWORD_RECOVERY")setPasswordRecovery(true); });
    return () => listener.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (demo || !session) return;
    const load = async () => {
      const supabase = getSupabase(); if (!supabase) return;
      setLoading(true);
      const { data: tenantRows } = await supabase.rpc("crm_my_tenants");
      const first = Array.isArray(tenantRows) ? tenantRows[0] : null;
      if (first) {
        const current: Tenant = { id:first.tenant_id, slug:first.tenant_slug, name:first.tenant_name, status:first.tenant_status, plan_code:first.plan_code, role:first.member_role };
        setTenant(current);
        const [leadRes, campaignRes, botRes] = await Promise.all([
          supabase.from("crm_leads").select("id,full_name,username,telegram_chat_id,language,status,first_source,deposit_total,rebate_total,puprime_status,created_at").eq("tenant_id", current.id).order("created_at", { ascending:false }).limit(100),
          supabase.from("crm_campaigns").select("id,name,language,source_channel,deep_link_code,active").eq("tenant_id", current.id).order("name"),
          supabase.from("crm_tenant_bots").select("id,name,username,mode,status,admin_chat_id,default_language,last_tested_at,last_error").eq("tenant_id", current.id).order("created_at"),
        ]);
        setLeads((leadRes.data || []) as Lead[]); setCampaigns((campaignRes.data || []) as Campaign[]); setBots((botRes.data || []) as TenantBot[]);
      }
      setLoading(false);
    };
    load();
  }, [demo, session]);

  if (!authReady) return <div className="loading">{locale==="en"?"Secure connection…":"Connessione sicura…"}</div>;
  if (passwordRecovery) return <ResetPassword onDone={()=>setPasswordRecovery(false)}/>;
  if (!demo && !session) return <Login onDemo={() => setDemo(true)} />;

  const active = nav.find(item => item.key === page)!;
  const title = locale==="en"?(englishNav[active.key]||active.label):active.label;
  const closeAndSet = (key: PageKey) => { setPage(key); setMenu(false); };
  const signOut = async () => { if (demo) { setDemo(false); return; } await getSupabase()?.auth.signOut(); };

  return <div className="shell">
    <aside className={menu ? "sidebar open" : "sidebar"}>
      <div className="brand"><div className="brandMark">X</div><div><strong>XAU MACHINE</strong><small>CRM · SaaS</small></div><button className="iconBtn closeMenu" onClick={()=>setMenu(false)} aria-label="Chiudi"><X/></button></div>
      <div className="tenant"><span className="liveDot"/><div><b>{tenant?.name || "CRM"}</b><small>{tenant?.plan_code.toUpperCase()} · {tenant?.role || "viewer"}</small></div></div>
      <nav>{nav.filter(item=>demo||item.key!=="vision").map(item => <button key={item.key} className={page===item.key?"navItem active":"navItem"} onClick={()=>closeAndSet(item.key)}><item.icon/><span>{locale==="en"?(englishNav[item.key]||item.label):item.label}</span></button>)}</nav>
      <button className="navItem signout" onClick={signOut}><LogOut/><span>{locale==="en"?(demo?"Exit demo":"Sign out"):(demo?"Esci dalla demo":"Disconnetti")}</span></button>
    </aside>
    {menu && <button className="scrim" onClick={()=>setMenu(false)} aria-label="Chiudi menu"/>}
    <main>
      <header><button className="iconBtn mobileMenu" onClick={()=>setMenu(true)}><Menu/></button><div><p>XAU Machine / {title}</p><h1>{title}</h1></div><div className="headerActions"><div className="localeSwitch"><a className={locale==="it"?"active":""} href={demo?"?demo=1&lang=it":"?lang=it"}>IT</a><a className={locale==="en"?"active":""} href={demo?"?demo=1&lang=en":"?lang=en"}>EN</a></div><span className={demo?"mode demo":"mode"}>{demo?"DEMO":"LIVE"}</span><button className="iconBtn" disabled title={locale==="en"?"Notification centre not active":"Centro notifiche non attivo"}><BellRing/></button><div className="avatar">GO</div></div></header>
      {demo && <div className="demoBanner"><b>{locale==="en"?"Read-only demo mode.":"Modalità demo in sola lettura."}</b> {locale==="en"?"All figures are simulated and do not represent real clients.":"I dati sono simulati e non rappresentano clienti reali."}</div>}
      <section className="content">{loading ? <div className="loadingCard">{locale==="en"?"Updating data…":"Aggiornamento dati…"}</div> : <Page page={page} locale={locale} onNavigate={setPage} leads={leads} campaigns={campaigns} bots={bots} onBotsChange={setBots} tenant={tenant} demo={demo}/>}</section>
    </main>
  </div>;
}

function Login({ onDemo }:{onDemo:()=>void}) {
  const [email,setEmail]=useState("infogaetano@yahoo.it"); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");const client=getSupabase();if(!client){setError("Configurazione Supabase mancante.");setBusy(false);return;}const {error:err}=await client.auth.signInWithPassword({email,password});if(err)setError(err.message);setBusy(false);};
  const recover=async()=>{setBusy(true);setError("");const client=getSupabase();if(!client){setError("Configurazione Supabase mancante.");setBusy(false);return;}const {error:err}=await client.auth.resetPasswordForEmail(email,{redirectTo:location.origin});setError(err?err.message:"Link inviato. Controlla anche Spam e Posta indesiderata.");setBusy(false);};
  return <main className="loginPage"><div className="loginGlow"/><form className="loginCard" onSubmit={submit}><div className="loginLogo">X</div><p className="eyebrow">XAU MACHINE</p><h1>Il centro operativo<br/>del tuo business.</h1><p className="muted">Lead, conversazioni, follow-up, PU Prime e campagne in un’unica piattaforma.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className={error.startsWith("Link inviato")?"successNote":"error"}>{error}</div>}<button className="primary" disabled={busy}>{busy?"Accesso…":"Accedi al CRM"}</button><button type="button" className="secondary" disabled={busy} onClick={recover}>Password dimenticata</button><button type="button" className="secondary" onClick={onDemo}>Apri demo in sola lettura</button><small>Accesso protetto · Dati isolati per cliente</small></form></main>;
}

function ResetPassword({onDone}:{onDone:()=>void}){
  const [password,setPassword]=useState(""); const [confirm,setConfirm]=useState(""); const [notice,setNotice]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();if(password.length<10)return setNotice("Usa almeno 10 caratteri.");if(password!==confirm)return setNotice("Le due password non coincidono.");setBusy(true);const client=getSupabase();if(!client){setNotice("Configurazione Supabase mancante.");setBusy(false);return;}const {error}=await client.auth.updateUser({password});setNotice(error?error.message:"Password aggiornata correttamente.");setBusy(false);if(!error)setTimeout(onDone,800);};
  return <main className="loginPage"><div className="loginGlow"/><form className="loginCard" onSubmit={submit}><div className="loginLogo">X</div><p className="eyebrow">RECUPERO ACCESSO</p><h1>Crea la nuova password</h1><p className="muted">Scegli una password facile da ricordare ma lunga almeno 10 caratteri.</p><label>Nuova password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={10} required autoComplete="new-password"/></label><label>Ripeti password<input type="password" value={confirm} onChange={e=>setConfirm(e.target.value)} minLength={10} required autoComplete="new-password"/></label>{notice&&<div className={notice.includes("correttamente")?"successNote":"error"}>{notice}</div>}<button className="primary" disabled={busy}>{busy?"Aggiornamento…":"Salva nuova password"}</button></form></main>;
}

function Page({page,locale,onNavigate,leads,campaigns,bots,onBotsChange,tenant,demo}:{page:PageKey;locale:Locale;onNavigate:(page:PageKey)=>void;leads:Lead[];campaigns:Campaign[];bots:TenantBot[];onBotsChange:(bots:TenantBot[])=>void;tenant:Tenant|null;demo:boolean}) {
  switch(page){
    case "vision": return <B2BVision locale={locale} leads={leads} campaigns={campaigns} onNavigate={onNavigate}/>;
    case "dashboard": return <Dashboard locale={locale} leads={leads} campaigns={campaigns} demo={demo}/>;
    case "leads": return <Leads locale={locale} leads={leads}/>;
    case "campaigns": return <Campaigns locale={locale} campaigns={campaigns} leads={leads}/>;
    case "conversations": return <Conversations locale={locale} leads={leads} tenant={tenant} demo={demo}/>;
    case "followups": return <Followups locale={locale} tenant={tenant} demo={demo}/>;
    case "handoffs": return <Handoffs locale={locale} tenant={tenant} leads={leads} demo={demo} onNavigate={onNavigate}/>;
    case "puprime": return <PuPrime locale={locale} leads={leads} demo={demo}/>;
    case "economics": return <Economics locale={locale} leads={leads} campaigns={campaigns} tenant={tenant} demo={demo}/>;
    case "prompt": return <Prompt locale={locale} tenant={tenant} demo={demo}/>;
    case "materials": return <Materials locale={locale} tenant={tenant} demo={demo}/>;
    case "integrations": return <Integrations locale={locale} tenant={tenant} demo={demo}/>;
    case "bots": return <WhiteLabelBots locale={locale} tenant={tenant} bots={bots} onChange={onBotsChange} demo={demo}/>;
    case "tenants": return <Tenants locale={locale} current={tenant}/>;
    case "billing": return <Billing locale={locale} tenant={tenant} bots={bots} demo={demo}/>;
    case "settings": return <SettingsPage locale={locale} demo={demo}/>;
  }
}

function B2BVision({locale,leads,campaigns,onNavigate}:{locale:Locale;leads:Lead[];campaigns:Campaign[];onNavigate:(page:PageKey)=>void}){
  const en=locale==="en";
  const conversion=34;
  return <>
    <div className="visionHero"><div><span className="visionBadge">{en?"COMMERCIAL DEMO · SIMULATED DATA":"DEMO COMMERCIALE · DATI SIMULATI"}</span><h2>{en?"Show clients the full value of the CRM in seconds.":"Mostra al cliente tutto il valore del CRM, in pochi secondi."}</h2><p>{en?"Leads, bilingual conversations, automations, PU Prime, advertising costs and white-label bots in one complete view.":"Lead, conversazioni bilingui, automazioni, PU Prime, costi pubblicitari e bot white label in una vista completa."}</p><div className="visionActions"><button className="primary bigAction" onClick={()=>onNavigate("conversations")}><MessageCircle/> {en?"Open conversations":"Apri conversazioni"}</button><button className="secondary bigAction" onClick={()=>onNavigate("leads")}><Users/> {en?"Explore leads":"Esplora i lead"}</button><a className="secondary bigAction" href={SIGNAL_ROOM_URL} target="_blank" rel="noreferrer"><Activity/> {en?"Open signal room":"Apri sala segnali"}</a></div></div><div className="visionScore"><small>{en?"Demo conversion":"Conversione demo"}</small><strong>{conversion}%</strong><span>{en?"Lead → verified client":"Lead → cliente verificato"}</span><i><b style={{width:`${conversion}%`}}/></i></div></div>
    <div className="stats visionStats"><Stat label={en?"Leads acquired":"Lead acquisiti"} value="1.248" delta={en?"+18% last 30 days":"+18% ultimi 30 giorni"} icon={<Users/>}/><Stat label={en?"Attributed deposits":"Depositi attribuiti"} value="€384.000" delta={en?"Across all channels":"Tutti i canali"} icon={<CircleDollarSign/>}/><Stat label={en?"PU Prime rebates":"Rebate PU Prime"} value="€67.000" delta={en?"3 IB summary":"Riepilogo 3 IB"} icon={<Activity/>}/><Stat label={en?"Advertising spend":"Spesa advertising"} value="€8.000" delta={en?"CPA €18.69":"CPA €18,69"} icon={<CreditCard/>}/></div>
    <div className="grid2 visionGrid"><Panel title={en?"B2B sales funnel":"Funnel commerciale B2B"} action={en?"DEMO DATA":"DATI DEMO"}><Pipeline leads={leads} locale={locale}/><button className="panelCta" onClick={()=>onNavigate("followups")}>{en?"Manage follow-ups":"Gestisci follow-up"} <Workflow/></button></Panel><Panel title={en?"Recent conversations":"Conversazioni recenti"} action="LIVE DEMO"><div className="visionChats">{demoConversations.slice(0,5).map(chat=><button key={chat.id} onClick={()=>onNavigate("conversations")}><div className="avatar smallAvatar">{chat.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{chat.name}</b><small>{chat.messages.at(-1)?.text}</small></span><em className={`langPill ${chat.language}`}>{chat.language.toUpperCase()}</em>{chat.unread>0&&<i>{chat.unread}</i>}</button>)}</div></Panel></div>
    <div className="grid2"><Panel title={en?"Channels and campaigns":"Canali e campagne"} action={`${campaigns.length} ${en?"ACTIVE":"ATTIVE"}`}><div className="channelLeaderboard">{[["Leo Italia","IT",428,"€ 15,90"],["LeoTrading English","EN",341,"€ 19,20"],["Alice Trading","IT",276,"€ 17,60"],["New Zealand","EN",203,"€ 24,30"]].map(([name,language,leadsCount,cpa],index)=><div key={String(name)}><b>{index+1}</b><span><strong>{name}</strong><small>{language} · Telegram</small></span><em>{leadsCount} lead</em><i>{cpa} CPA</i></div>)}</div><button className="panelCta" onClick={()=>onNavigate("economics")}>{en?"Open CPA analysis":"Apri analisi CPA"} <BarChart3/></button></Panel><Panel title={en?"Platform status":"Stato piattaforma"} action={en?"OPERATIONAL":"OPERATIVA"}><SystemStatus locale={locale}/><div className="visionSystemActions"><button className="secondary" onClick={()=>onNavigate("integrations")}>{en?"Configure integrations":"Configura integrazioni"}</button><button className="primary" onClick={()=>onNavigate("handoffs")}>{en?"Human support":"Interventi umani"}</button></div></Panel></div>
  </>;
}

function Dashboard({locale,leads,campaigns,demo}:{locale:Locale;leads:Lead[];campaigns:Campaign[];demo:boolean}) {
  const en=locale==="en"; const deposits=demo?384000:leads.reduce((s,l)=>s+Number(l.deposit_total||0),0), rebates=demo?67000:leads.reduce((s,l)=>s+Number(l.rebate_total||0),0), active=demo?398:leads.filter(l=>l.status==="active").length;
  return <><div className="stats"><Stat label={en?"Total leads":"Lead totali"} value={demo?"1.248":String(leads.length)} delta={demo?(en?"+12% vs previous period":"+12% vs periodo"):(en?"Real database":"Database reale")} icon={<Users/>}/><Stat label={en?"Attributed deposits":"Depositi attribuiti"} value={eur.format(deposits)} delta="PU Prime" icon={<CircleDollarSign/>}/><Stat label="Rebate" value={eur.format(rebates)} delta={demo?"3 IB":(en?"Imported values":"Valori importati")} icon={<Activity/>}/><Stat label={en?"Active clients":"Clienti attivi"} value={String(active)} delta={`${campaigns.length} ${en?"campaigns":"campagne"}`} icon={<ShieldCheck/>}/></div><div className="grid2"><Panel title={en?"Sales pipeline":"Pipeline commerciale"} action={en?"Real stages":"Fasi reali"}><Pipeline leads={leads} locale={locale}/></Panel><Panel title={en?"Recent lead activity":"Attività lead recente"} action={demo?"DEMO":(en?"DATABASE":"DATABASE")}><Timeline locale={locale} leads={leads} demo={demo}/></Panel></div><div className="grid2"><Panel title={en?"Channels":"Canali"} action={demo?(en?"Demo performance":"Performance demo"):(en?"Real lead count":"Conteggio lead reale")}><Bars campaigns={campaigns} leads={leads} demo={demo}/></Panel><Panel title={en?"Verified connections":"Connessioni verificate"} action={en?"Current check":"Controllo attuale"}><SystemStatus locale={locale}/></Panel></div></>;
}

function Stat({label,value,delta,icon}:{label:string;value:string;delta:string;icon:React.ReactNode}){return <div className="stat"><div className="statIcon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{delta}</small></div>}
function Panel({title,action,children}:{title:string;action?:string;children:React.ReactNode}){return <div className="panel"><div className="panelHead"><h2>{title}</h2>{action&&<span>{action}</span>}</div>{children}</div>}
function Pipeline({leads,locale="it"}:{leads:Lead[];locale?:Locale}){const steps=["new","conversation","registration","ib_verification","active"];const labels=locale==="en"?["New","In chat","Registration","IB verification","Active"]:["Nuovi","In chat","Registrazione","Verifica IB","Attivi"];return <div className="pipeline">{steps.map((s,i)=><div key={s}><span>{labels[i]}</span><b>{leads.filter(l=>l.status===s).length}</b><i style={{width:`${Math.max(8,leads.filter(l=>l.status===s).length/Math.max(1,leads.length)*100)}%`}}/></div>)}</div>}
function Timeline({locale="it",leads,demo}:{locale?:Locale;leads:Lead[];demo:boolean}){const en=locale==="en";if(demo)return <div className="timeline"><div><i/><b>{en?"New lead acquired":"Nuovo lead acquisito"}</b><small>Leo Italia · {en?"now":"adesso"}</small></div><div><i/><b>{en?"PU Prime check completed":"Controllo PU Prime completato"}</b><small>3 IB · 18 min</small></div></div>;if(leads.length===0)return <div className="emptyState"><p>{en?"No real activity yet.":"Nessuna attività reale disponibile."}</p></div>;return <div className="timeline">{leads.slice(0,4).map(lead=><div key={lead.id}><i/><b>{lead.full_name||lead.username||(en?"New Telegram lead":"Nuovo lead Telegram")}</b><small>{lead.first_source||"Telegram"} · {relativeTime(lead.created_at||null,locale)}</small></div>)}</div>}
function Bars({campaigns,leads,demo}:{campaigns:Campaign[];leads:Lead[];demo:boolean}){const counts=campaigns.map(c=>leads.filter(l=>[c.deep_link_code,c.source_channel].filter(Boolean).includes(l.first_source)).length);const maximum=Math.max(1,...counts);return <div className="bars">{campaigns.slice(0,5).map((c,i)=>{const value=demo?88-i*12:counts[i];return <div key={c.id}><span>{c.name}</span><i><b style={{width:`${demo?value:Math.max(value?8:0,value/maximum*100)}%`}}/></i><em>{demo?`${value}%`:`${value} lead`}</em></div>})}</div>}
function SystemStatus({locale="it"}:{locale?:Locale}={}){const en=locale==="en";return <div className="systems">{[["Telegram",en?"Messages stored":"Messaggi salvati"],["Supabase",en?"Database + Realtime":"Database + Realtime"],["PU Prime",en?"Data shown when imported":"Dati solo se importati"],["AI",en?"Server function active":"Funzione server attiva"]].map(([a,b],index)=><div key={a}><span className={index<2?"okDot":"warnDot"}/><b>{a}</b><small>{b}</small></div>)}</div>}

function Leads({locale,leads}:{locale:Locale;leads:Lead[]}){const en=locale==="en";const [query,setQuery]=useState("");const filtered=leads.filter(lead=>`${lead.full_name||""} ${lead.username||""} ${lead.first_source||""}`.toLowerCase().includes(query.trim().toLowerCase()));return <Panel title={en?"Leads and clients":"Lead e clienti"} action={`${filtered.length} ${en?"results":"risultati"}`}><div className="toolbar"><div className="search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={en?"Search name or Telegram…":"Cerca nome o Telegram…"}/></div><button className="secondary small" disabled title={en?"Leads are created automatically by Telegram":"I lead vengono creati automaticamente da Telegram"}>{en?"Automatic from Telegram":"Automatici da Telegram"}</button></div><div className="table"><div className="tr th"><span>{en?"Client":"Cliente"}</span><span>{en?"Stage":"Fase"}</span><span>{en?"Language":"Lingua"}</span><span>{en?"Deposit":"Deposito"}</span><span>PU Prime</span></div>{filtered.map(l=><div className="tr" key={l.id}><span><b>{l.full_name||l.username||(en?"Unnamed":"Senza nome")}</b><small>{l.first_source}</small></span><span><Status value={l.status}/></span><span>{l.language.toUpperCase()}</span><span>{eur.format(Number(l.deposit_total||0))}</span><span><Status value={l.puprime_status}/></span></div>)}</div></Panel>}
function Status({value}:{value:string}){return <em className={`status ${value}`}>{value.replaceAll("_"," ")}</em>}
function Campaigns({campaigns,locale,leads}:{campaigns:Campaign[];locale:Locale;leads:Lead[]}){const en=locale==="en";return <><div className="pageIntro"><div><h2>{en?"Automatic attribution":"Attribuzione automatica"}</h2><p>{en?"Every Telegram link identifies its channel, language and campaign. KPIs below use real CRM data.":"Ogni link Telegram identifica canale, lingua e campagna. I dati sotto provengono dal CRM reale."}</p></div><a className="primary small" href={SIGNAL_ROOM_URL} target="_blank" rel="noreferrer">{en?"Open signal room":"Apri sala segnali"}</a></div><div className="cardGrid">{campaigns.map(c=>{const attributed=leads.filter(lead=>[c.deep_link_code,c.source_channel].filter(Boolean).includes(lead.first_source));const deposited=attributed.filter(lead=>Number(lead.deposit_total||0)>0).length;return <div className="campaignCard" key={c.id}><div><span className="lang">{c.language.toUpperCase()}</span><Status value={c.active?"active":"paused"}/></div><h3>{c.name}</h3><p>{en?"Code":"Codice"}: <b>{c.deep_link_code}</b></p><code>t.me/XauMachineAisupport_bot?start={c.deep_link_code}</code><div className="miniStats"><span><b>{attributed.length}</b> lead</span><span><b>—</b> CPA</span><span><b>{attributed.length?Math.round(deposited/attributed.length*100):0}%</b> conv.</span></div></div>})}</div></>}
function formatClock(value:string){return new Intl.DateTimeFormat("it-IT",{hour:"2-digit",minute:"2-digit"}).format(new Date(value));}
function relativeTime(value:string|null,locale:Locale){
  if(!value)return "—";
  const seconds=Math.max(0,Math.round((Date.now()-new Date(value).getTime())/1000));
  if(seconds<60)return locale==="en"?"now":"ora";
  if(seconds<3600)return `${Math.floor(seconds/60)} min`;
  if(seconds<86400)return `${Math.floor(seconds/3600)} h`;
  return `${Math.floor(seconds/86400)} g`;
}

function Conversations({leads,tenant,demo,locale}:{leads:Lead[];tenant:Tenant|null;demo:boolean;locale:Locale}){
  const [conversationRows,setConversationRows]=useState<ConversationRow[]>([]);
  const [messageRows,setMessageRows]=useState<MessageRow[]>([]);
  const [selectedId,setSelectedId]=useState("");
  const [mobileOpen,setMobileOpen]=useState(false);
  const [query,setQuery]=useState("");
  const [languageFilter,setLanguageFilter]=useState<"all"|"it"|"en">("all");
  const [loading,setLoading]=useState(!demo);
  const [error,setError]=useState("");
  const [realtimeState,setRealtimeState]=useState(demo?"demo":"connecting");
  const en=locale==="en";

  const loadConversations=useCallback(async()=>{
    if(demo||!tenant)return;
    const client=getSupabase(); if(!client)return;
    setError("");
    const [conversationsResult,messagesResult]=await Promise.all([
      client.from("crm_conversations").select("id,lead_id,channel,status,last_message_at").eq("tenant_id",tenant.id).order("last_message_at",{ascending:false}),
      client.from("crm_messages").select("id,conversation_id,direction,sender_type,body,created_at").eq("tenant_id",tenant.id).order("created_at",{ascending:true}).limit(2000),
    ]);
    if(conversationsResult.error||messagesResult.error){
      const message=conversationsResult.error?.message||messagesResult.error?.message||"Errore sconosciuto";
      setError(`${en?"Unable to load conversations":"Impossibile caricare le conversazioni"}: ${message}`);
    }else{
      setConversationRows((conversationsResult.data||[]) as ConversationRow[]);
      setMessageRows((messagesResult.data||[]) as MessageRow[]);
    }
    setLoading(false);
  },[demo,tenant,en]);

  useEffect(()=>{void loadConversations();},[loadConversations]);

  useEffect(()=>{
    if(demo||!tenant)return;
    const client=getSupabase(); if(!client)return;
    const channel=client.channel(`crm-live-${tenant.id}-${Date.now()}`)
      .on("postgres_changes",{event:"*",schema:"public",table:"crm_messages",filter:`tenant_id=eq.${tenant.id}`},()=>void loadConversations())
      .on("postgres_changes",{event:"*",schema:"public",table:"crm_conversations",filter:`tenant_id=eq.${tenant.id}`},()=>void loadConversations())
      .on("postgres_changes",{event:"*",schema:"public",table:"crm_leads",filter:`tenant_id=eq.${tenant.id}`},()=>void loadConversations())
      .subscribe((status:string)=>setRealtimeState(status.toLowerCase()));
    return()=>{void client.removeChannel(channel);};
  },[demo,tenant,loadConversations]);

  const liveChats=useMemo<LiveChat[]>(()=>{
    const leadMap=new Map(leads.map(lead=>[lead.id,lead]));
    return conversationRows.map(conversation=>{
      const lead=leadMap.get(conversation.lead_id);
      const rows=messageRows.filter(message=>message.conversation_id===conversation.id);
      const messages:ChatMessage[]=rows.map(message=>({
        id:message.id,
        side:message.direction==="inbound"?"lead":"ai",
        sender:message.sender_type,
        text:message.body||"",
        time:formatClock(message.created_at),
        createdAt:message.created_at,
      }));
      let unread=0;
      for(let index=messages.length-1;index>=0&&messages[index].side==="lead";index--)unread++;
      return {
        id:conversation.id,leadId:conversation.lead_id,
        name:lead?.full_name||lead?.username||"Conversazione Telegram",
        username:lead?.username||null,language:lead?.language||"it",
        stage:lead?.status||conversation.status||"conversation",
        time:relativeTime(conversation.last_message_at,locale),unread,messages,
      };
    });
  },[conversationRows,messageRows,leads,locale]);

  const demoChats=useMemo<LiveChat[]>(()=>demoConversations.map(chat=>({
    ...chat,
    leadId:chat.id,
    username:null,
    messages:chat.messages.map((message,index)=>({
      id:`${chat.id}-${index}`,
      side:message.side as "lead"|"ai",
      sender:message.side==="lead"?"lead":"assistant",
      text:message.text,
      time:message.time,
      createdAt:new Date(0).toISOString(),
    })),
  })),[]);
  const chats=demo?demoChats:liveChats;
  const filteredChats=chats.filter(chat=>{
    const text=`${chat.name} ${chat.username||""} ${chat.messages.at(-1)?.text||""}`.toLowerCase();
    return (languageFilter==="all"||chat.language===languageFilter)&&text.includes(query.trim().toLowerCase());
  });
  useEffect(()=>{
    if(chats.length>0&&!chats.some(chat=>chat.id===selectedId))setSelectedId(chats[0].id);
  },[chats,selectedId]);
  const selected=chats.find(chat=>chat.id===selectedId)||chats[0];
  const realtimeOk=demo||realtimeState==="subscribed";

  return <div className={`chatLayout b2bChat ${mobileOpen?"mobileChatOpen":""}`}>
    <div className="chatList">
      <div className="chatListHead"><b>Inbox</b><span className={realtimeOk?"realtimeOk":"realtimeWait"}>{demo?"DEMO":realtimeOk?"● LIVE":"○ CONNESSIONE"}</span></div>
      <div className="search"><Search/><input value={query} onChange={event=>setQuery(event.target.value)} placeholder={en?"Search chats…":"Cerca chat…"}/></div>
      <div className="chatFilters"><button className={languageFilter==="all"?"active":""} onClick={()=>setLanguageFilter("all")}>{en?"All":"Tutte"}</button><button className={languageFilter==="it"?"active":""} onClick={()=>setLanguageFilter("it")}>IT</button><button className={languageFilter==="en"?"active":""} onClick={()=>setLanguageFilter("en")}>EN</button></div>
      {loading&&<div className="chatNotice">{en?"Loading real conversations…":"Caricamento conversazioni reali…"}</div>}
      {error&&<div className="error chatNotice">{error}<button className="secondary small" onClick={()=>void loadConversations()}>{en?"Retry":"Riprova"}</button></div>}
      {!loading&&!error&&filteredChats.length===0&&<div className="chatNotice">{en?"No conversations found.":"Nessuna conversazione trovata."}</div>}
      {filteredChats.map(chat=><button key={chat.id} onClick={()=>{setSelectedId(chat.id);setMobileOpen(true);}} className={selected?.id===chat.id?"chatRow selected":"chatRow"}><div className="avatar smallAvatar">{chat.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{chat.name}</b><small>{chat.messages.at(-1)?.text||"—"}</small><i>{chat.stage}</i></span><em>{chat.time}{chat.unread>0&&<strong>{chat.unread}</strong>}</em></button>)}
    </div>
    <div className="chatWindow">{selected?<>
      <div className="chatTop"><button className="iconBtn mobileChatBack" onClick={()=>setMobileOpen(false)} aria-label={en?"Back to conversations":"Torna alle conversazioni"}><ChevronLeft/></button><div className="avatar">{selected.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{selected.name}</b><small>Telegram · {selected.username?`@${selected.username.replace(/^@/,"")} · `:""}{selected.language.toUpperCase()} · {selected.stage}</small></span><div className="chatTopActions"><button className="secondary" onClick={()=>window.open(`https://translate.google.com/?sl=auto&tl=${locale}&op=translate`,"_blank","noopener,noreferrer")}>{en?"Translate":"Traduci"}</button></div></div>
      <div className="messages">{selected.messages.map(message=><div key={message.id} className={`message ${message.side}`}><small>{message.side==="ai"?(message.sender==="operator"?"Operatore":"AI Assistant"):selected.name}</small><p>{message.text}</p><time>{message.time}</time></div>)}</div>
      <div className="composer composerDisabled"><textarea placeholder={en?"Operator replies will be enabled after the secure Telegram outbox test.":"Le risposte operatore saranno abilitate dopo il test sicuro della coda Telegram."} readOnly/><button className="primary" disabled>{en?"Send":"Invia"}</button></div>
    </>:<div className="emptyChat"><MessageCircle/><h2>{en?"No active conversations":"Nessuna conversazione attiva"}</h2><p>{en?"New Telegram messages will appear here automatically.":"I nuovi messaggi Telegram compariranno qui automaticamente."}</p></div>}</div>
  </div>;
}
function Followups({locale,tenant,demo}:{locale:Locale;tenant:Tenant|null;demo:boolean}){const en=locale==="en";const [rules,setRules]=useState<FollowupRuleRow[]>([]);const [loading,setLoading]=useState(!demo);const [error,setError]=useState("");useEffect(()=>{if(demo||!tenant){setLoading(false);return;}const load=async()=>{const client=getSupabase();if(!client)return;const result=await client.from("crm_followup_rules").select("id,name,trigger_event,lead_status,delay_minutes,channel,message_template,stop_on_reply,enabled").eq("tenant_id",tenant.id).order("created_at");if(result.error)setError(result.error.message);else setRules((result.data||[]) as FollowupRuleRow[]);setLoading(false);};void load();},[demo,tenant]);const visible=demo?[{id:"demo-1",name:en?"2-hour inactivity":"Assenza 2 ore",trigger_event:"no_reply",lead_status:"conversation",delay_minutes:120,channel:"telegram",message_template:en?"Did you have any other questions?":"Avevi altre domande? Posso aiutarti?",stop_on_reply:true,enabled:true},{id:"demo-2",name:en?"IB change requested":"Cambio IB richiesto",trigger_event:"ib_change",lead_status:"ib_verification",delay_minutes:4320,channel:"telegram",message_template:en?"Did you receive the PU Prime confirmation?":"Hai ricevuto la conferma PU Prime?",stop_on_reply:true,enabled:true}]:rules;return <><div className="pageIntro"><div><h2>{en?"Follow-up rules":"Regole follow-up"}</h2><p>{en?"Only rules actually stored in the database are displayed here.":"Qui sono mostrate soltanto le regole realmente salvate nel database."}</p></div><button className="secondary small" disabled title={en?"Rule editor not yet enabled":"Editor regole non ancora abilitato"}>{en?"Editor not active":"Editor non attivo"}</button></div>{loading?<div className="loadingCard">{en?"Loading…":"Caricamento…"}</div>:error?<div className="error">{error}</div>:visible.length===0?<div className="emptyState"><Workflow/><h3>{en?"No rules configured":"Nessuna regola configurata"}</h3></div>:<div className="cardGrid">{visible.map(rule=><Rule key={rule.id} rule={rule} locale={locale}/>)}</div>}</>}
function Rule({locale,rule}:{locale:Locale;rule:FollowupRuleRow}){const delay=rule.delay_minutes>=1440?`${Math.round(rule.delay_minutes/1440)} g`:rule.delay_minutes>=60?`${Math.round(rule.delay_minutes/60)} h`:`${rule.delay_minutes} min`;return <div className="rule"><div><Workflow/><Status value={rule.enabled?"active":"paused"}/></div><h3>{rule.name}</h3><b>{rule.trigger_event} · {delay}</b><small>{rule.lead_status||"tutti gli stati"} · {rule.channel}</small><p>“{rule.message_template}”</p><button className="secondary small" disabled>{locale==="en"?"Read only":"Sola lettura"}</button></div>}
function Handoffs({locale,tenant,leads,demo,onNavigate}:{locale:Locale;tenant:Tenant|null;leads:Lead[];demo:boolean;onNavigate:(page:PageKey)=>void}){const en=locale==="en";const [items,setItems]=useState<HandoffRow[]>([]);const [loading,setLoading]=useState(!demo);const [error,setError]=useState("");useEffect(()=>{if(demo||!tenant){setLoading(false);return;}const load=async()=>{const client=getSupabase();if(!client)return;const result=await client.from("crm_human_handoffs").select("id,lead_id,conversation_id,reason,priority,requested_channel,status,assigned_to,created_at").eq("tenant_id",tenant.id).order("created_at",{ascending:false});if(result.error)setError(result.error.message);else setItems((result.data||[]) as HandoffRow[]);setLoading(false);};void load();},[demo,tenant]);const pending=items.filter(item=>item.status==="pending"||item.status==="open").length;const active=items.filter(item=>item.status==="in_progress").length;const resolved=items.filter(item=>item.status==="resolved").length;return <><div className="stats"><Stat label={en?"Unassigned":"Da prendere"} value={String(pending)} delta={en?"Real queue":"Coda reale"} icon={<BellRing/>}/><Stat label={en?"In progress":"In gestione"} value={String(active)} delta={en?"Real queue":"Coda reale"} icon={<Users/>}/><Stat label={en?"Total requests":"Richieste totali"} value={String(items.length)} delta={en?"Database":"Database"} icon={<Gauge/>}/><Stat label={en?"Resolved":"Risolte"} value={String(resolved)} delta={en?"Database":"Database"} icon={<ShieldCheck/>}/></div><Panel title={en?"Operator queue":"Coda operatore"}>{loading?<div className="loadingCard">{en?"Loading…":"Caricamento…"}</div>:error?<div className="error">{error}</div>:items.length===0?<div className="emptyState"><BellRing/><h3>{en?"No human requests":"Nessuna richiesta umana"}</h3><p>{en?"The queue is currently empty.":"La coda reale è vuota in questo momento."}</p></div>:items.map(item=>{const lead=leads.find(value=>value.id===item.lead_id);const name=lead?.full_name||lead?.username||(en?"Telegram lead":"Lead Telegram");return <div className="handoff" key={item.id}><div className="avatar">{name.slice(0,2).toUpperCase()}</div><div><b>{name}</b><p>{item.reason}</p><small>{item.requested_channel} · {relativeTime(item.created_at,locale)}</small></div><Status value={item.priority||item.status}/><div className="rowActions"><button className="secondary small" disabled>{item.status}</button><button className="primary small" onClick={()=>onNavigate("conversations")}>{en?"Open chats":"Apri chat"}</button></div></div>})}</Panel></>}
function PuPrime({locale,leads,demo}:{locale:Locale;leads:Lead[];demo:boolean}){const en=locale==="en",dep=demo?384000:leads.reduce((s,l)=>s+Number(l.deposit_total||0),0),reb=demo?67000:leads.reduce((s,l)=>s+Number(l.rebate_total||0),0);return <><div className="stats"><Stat label="IB 23215978" value={demo?"€18.420":"—"} delta={en?"Period rebate":"Rebate periodo"} icon={<ShieldCheck/>}/><Stat label="IB 23217421" value={demo?"€31.860":"—"} delta={en?"Main IB":"IB principale"} icon={<ShieldCheck/>}/><Stat label="IB 7527073" value={demo?"€16.720":"—"} delta={en?"Period rebate":"Rebate periodo"} icon={<ShieldCheck/>}/><Stat label={en?"Total rebates":"Rebate totali"} value={eur.format(reb)} delta={`${eur.format(dep)} ${en?"deposits":"depositi"}`} icon={<CircleDollarSign/>}/></div><Panel title={en?"Client verification":"Verifiche cliente"}><div className="table"><div className="tr th"><span>{en?"Client":"Cliente"}</span><span>Account</span><span>IB</span><span>{en?"Deposit":"Deposito"}</span><span>{en?"Status":"Stato"}</span></div>{leads.map((l,index)=><div className="tr" key={l.id}><span><b>{l.full_name||(en?"Unnamed":"Senza nome")}</b></span><span>{demo?String(27651000+index*37):"—"}</span><span>{demo?["23215978","23217421","7527073"][index%3]:"—"}</span><span>{demo?eur.format([2500,5000,8000,12000][index%4]):eur.format(Number(l.deposit_total||0))}</span><span><Status value={l.puprime_status}/></span></div>)}</div></Panel></>}
function Economics({locale,leads,campaigns,tenant,demo}:{locale:Locale;leads:Lead[];campaigns:Campaign[];tenant:Tenant|null;demo:boolean}){
  const en=locale==="en";
  const [spends,setSpends]=useState<AdSpend[]>([]);
  const [campaignId,setCampaignId]=useState("");
  const [amount,setAmount]=useState("");
  const [periodStart,setPeriodStart]=useState("");
  const [periodEnd,setPeriodEnd]=useState("");
  const [conversationCount,setConversationCount]=useState(demo?1248:0);
  const [notice,setNotice]=useState("");
  const loadEconomics=async()=>{if(!tenant||demo)return;const client=getSupabase();if(!client)return;const [spendRes,conversationRes]=await Promise.all([client.from("crm_ad_spend").select("id,campaign_id,channel,language,amount,period_start,period_end").eq("tenant_id",tenant.id).order("created_at",{ascending:false}),client.from("crm_conversations").select("id",{count:"exact",head:true}).eq("tenant_id",tenant.id)]);setSpends((spendRes.data||[]) as AdSpend[]);setConversationCount(conversationRes.count||0);};
  useEffect(()=>{loadEconomics();},[tenant,demo]);
  const saveSpend=async(e:FormEvent)=>{e.preventDefault();if(!tenant||demo)return;const numeric=Number(amount.replace(",","."));if(!Number.isFinite(numeric)||numeric<=0){setNotice(en?"Enter a valid amount.":"Inserisci un importo valido.");return;}const campaign=campaigns.find(item=>item.id===campaignId);const client=getSupabase();if(!client)return;const {error}=await client.from("crm_ad_spend").insert({tenant_id:tenant.id,campaign_id:campaign?.id||null,channel:campaign?.name||"Totale ads",language:campaign?.language||null,amount:numeric,currency:"EUR",period_start:periodStart||null,period_end:periodEnd||null});if(error){setNotice(`Errore: ${error.message}`);return;}setAmount("");setNotice(en?"Advertising cost saved.":"Costo advertising salvato.");await loadEconomics();};
  const adSpend=demo?8000:spends.reduce((sum,item)=>sum+Number(item.amount||0),0);
  const leadCount=demo?1248:leads.length;
  const deposits=demo?384000:leads.reduce((sum,lead)=>sum+Number(lead.deposit_total||0),0);
  const rebates=demo?67000:leads.reduce((sum,lead)=>sum+Number(lead.rebate_total||0),0);
  const depositing=demo?398:leads.filter(lead=>Number(lead.deposit_total||0)>0).length;
  const verified=demo?398:leads.filter(lead=>lead.puprime_status==="verified").length;
  const cpl=leadCount>0?adSpend/leadCount:0;
  const cpa=depositing>0?adSpend/depositing:0;
  const roas=adSpend>0?rebates/adSpend:0;
  const averageDeposit=depositing>0?deposits/depositing:0;
  const costPerChat=conversationCount>0?adSpend/conversationCount:0;
  const rows=demo?[["Leo Italia","IT",2150,428,137,21400],["LeoTrading English","EN",2320,341,102,18700],["Alice Trading","IT",1780,276,91,15600],["New Zealand","EN",1750,203,68,11300]]:campaigns.map(campaign=>{const campaignSpend=spends.filter(item=>item.campaign_id===campaign.id).reduce((sum,item)=>sum+Number(item.amount||0),0);const campaignLeads=leads.filter(lead=>lead.first_source===campaign.deep_link_code||lead.first_source===campaign.source_channel||lead.first_source.includes(campaign.deep_link_code||"__never__")).length;const campaignDeposits=leads.filter(lead=>(lead.first_source===campaign.deep_link_code||lead.first_source===campaign.source_channel)&&Number(lead.deposit_total||0)>0).length;const campaignRebates=leads.filter(lead=>lead.first_source===campaign.deep_link_code||lead.first_source===campaign.source_channel).reduce((sum,lead)=>sum+Number(lead.rebate_total||0),0);return [campaign.name,campaign.language.toUpperCase(),campaignSpend,campaignLeads,campaignDeposits,campaignRebates] as [string,string,number,number,number,number];});
  return <><div className="stats"><Stat label={en?"Advertising spend":"Spesa advertising"} value={eur.format(adSpend)} delta={en?"Saved periods":"Periodi salvati"} icon={<CreditCard/>}/><Stat label={en?"Cost per new chat":"Costo per nuova chat"} value={eur.format(costPerChat)} delta={`${conversationCount} chat`} icon={<MessageCircle/>}/><Stat label={en?"Cost per deposit":"Costo per deposito"} value={eur.format(cpa)} delta={`${depositing} ${en?"deposits":"depositi"}`} icon={<CircleDollarSign/>}/><Stat label={en?"PU Prime rebates":"Rebate PU Prime"} value={eur.format(rebates)} delta={`ROAS ${roas.toFixed(2)}x`} icon={<BarChart3/>}/></div>{!demo&&<Panel title={en?"Add advertising cost":"Inserisci costo advertising"} action={en?"TOTAL OR BY CHANNEL":"TOTALE O PER CANALE"}><form className="adSpendForm" onSubmit={saveSpend}><label>{en?"Campaign / channel":"Campagna / canale"}<select value={campaignId} onChange={e=>setCampaignId(e.target.value)}><option value="">{en?"General total (not attributed)":"Totale generale (non attribuito)"}</option>{campaigns.map(campaign=><option key={campaign.id} value={campaign.id}>{campaign.name} · {campaign.language.toUpperCase()}</option>)}</select></label><label>{en?"Amount (€)":"Importo (€)"}<input type="number" min="0.01" step="0.01" value={amount} onChange={e=>setAmount(e.target.value)} required/></label><label>{en?"From":"Dal"}<input type="date" value={periodStart} onChange={e=>setPeriodStart(e.target.value)}/></label><label>{en?"To":"Al"}<input type="date" value={periodEnd} onChange={e=>setPeriodEnd(e.target.value)}/></label><button className="primary">{en?"Save and calculate":"Salva e calcola"}</button></form>{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}</Panel>}<div className="grid2"><Panel title={en?"Business summary":"Riepilogo economico"} action={demo?(en?"SIMULATED DATA":"DATI SIMULATI"):(en?"LIVE DATA":"DATI REALI")}><div className="economySummary"><div><span>{en?"Attributed deposits":"Depositi attribuiti"}</span><b>{eur.format(deposits)}</b></div><div><span>{en?"Average deposit":"Deposito medio"}</span><b>{eur.format(averageDeposit)}</b></div><div><span>{en?"Verified customers":"Clienti verificati"}</span><b>{verified}</b></div><div><span>{en?"Net rebate after ads":"Rebate netto dopo ads"}</span><b className="positive">{eur.format(rebates-adSpend)}</b></div></div></Panel><Panel title={en?"Performance indicators":"Indicatori di rendimento"}><div className="roiRing"><strong>{roas.toFixed(2)}x</strong><span>Rebate / Ads</span></div><div className="roiNotes"><p><b>{eur.format(cpl)}</b> {en?"cost per lead":"costo per lead"}</p><p><b>{leadCount>0?Math.round(depositing/leadCount*100):0}%</b> {en?"lead-to-deposit conversion":"conversione lead-deposito"}</p><p><b>{eur.format(leadCount>0?rebates/leadCount:0)}</b> {en?"rebate per acquired lead":"rebate per lead acquisito"}</p></div></Panel></div><Panel title={en?"Performance by channel and language":"Performance per canale e lingua"}><div className="economyTable"><div className="economyRow economyHead"><span>{en?"Channel":"Canale"}</span><span>Ads</span><span>Lead</span><span>CPL</span><span>{en?"Deposits":"Depositi"}</span><span>CPA</span><span>Rebate</span></div>{rows.map(row=>{const [name,language,spend,rowLeads,rowDeposits,rowRebates]=row;return <div className="economyRow" key={String(name)}><span><b>{name}</b><small>{language}</small></span><span>{eur.format(Number(spend))}</span><span>{rowLeads}</span><span>{eur.format(Number(rowLeads)>0?Number(spend)/Number(rowLeads):0)}</span><span>{rowDeposits}</span><span>{eur.format(Number(rowDeposits)>0?Number(spend)/Number(rowDeposits):0)}</span><span>{eur.format(Number(rowRebates))}</span></div>})}</div></Panel></>;
}
function Prompt({locale,tenant,demo}:{locale:Locale;tenant:Tenant|null;demo:boolean}){
  const en=locale==="en";
  const [botName,setBotName]=useState("XAU Machine");
  const [strategy,setStrategy]=useState("1");
  const [content,setContent]=useState(en?"You are {{BOT_NAME}}, XAU Machine's sales assistant. Present strategy {{STRATEGY_NUMBER}}. Reply in free text, clearly and responsibly. Guide the client from the first question through registration, IB verification and deposit.":"Sei {{BOT_NAME}}, assistente commerciale XAU Machine. Presenta la strategia {{STRATEGY_NUMBER}}. Rispondi con testo libero, in modo chiaro e responsabile. Guida il cliente dalla domanda iniziale alla registrazione, verifica IB e deposito.");
  const [notice,setNotice]=useState("");
  useEffect(()=>{if(!tenant||demo)return;const client=getSupabase();if(!client)return;client.from("crm_prompt_versions").select("name,content,language,version").eq("tenant_id",tenant.id).eq("product","conversation").eq("active",true).in("language",[locale,"multi"]).order("version",{ascending:false}).then((result:{data:Array<{name:string;content:string;language:string;version:number}>|null})=>{const saved=(result.data||[]).find(row=>row.language===locale)||(result.data||[]).find(row=>row.language==="multi");if(saved){setContent(saved.content);setNotice(`${en?"Active prompt loaded":"Prompt attivo caricato"}: ${saved.name} · v${saved.version}`);}});},[tenant,demo,locale,en]);
  const resolved=content.replaceAll("{{BOT_NAME}}",botName.trim()||"XAU Machine").replaceAll("{{STRATEGY_NUMBER}}",strategy.trim()||"1");
  const importTxt=async(e:React.ChangeEvent<HTMLInputElement>)=>{const file=e.target.files?.[0];if(!file)return;if(file.size>5*1024*1024){setNotice("File oltre 5 MB.");return;}setContent(await file.text());setNotice(`${file.name} importato. Controlla l’anteprima e salva.`);};
  const savePrompt=async()=>{if(!tenant||demo)return;const client=getSupabase();if(!client)return;setNotice(en?"Saving…":"Salvataggio…");const {data:old}=await client.from("crm_prompt_versions").select("version").eq("tenant_id",tenant.id).eq("product","conversation").eq("language",locale).order("version",{ascending:false}).limit(1);await client.from("crm_prompt_versions").update({active:false}).eq("tenant_id",tenant.id).eq("product","conversation").eq("language",locale);const {error}=await client.from("crm_prompt_versions").insert({tenant_id:tenant.id,name:`${botName} · Strategia ${strategy}`,language:locale,content:resolved,product:"conversation",active:true,version:Number(old?.[0]?.version||0)+1});setNotice(error?`Errore: ${error.message}`:(en?"Prompt saved and activated.":"Prompt salvato e attivato."));};
  return <div className="editorLayout"><div className="editorNav"><button className="selected"><Sparkles/> {en?"Sales prompt":"Prompt commerciale"} <small>{botName}</small></button><button disabled title={en?"Translation editor not active":"Editor traduzioni non attivo"}><Languages/> {en?"Translations":"Traduzioni"} <small>{en?"Not active":"Non attivo"}</small></button><button disabled title={en?"Screenshot classifier not verified":"Classificatore screenshot non verificato"}><ShieldCheck/> {en?"Screenshots":"Screenshot"} <small>{en?"To verify":"Da verificare"}</small></button></div><div className="editor"><div className="panelHead"><div><h2>{en?"Conversation AI prompt":"Prompt AI conversazione"}</h2><p>{en?"Change the bot identity without rewriting the prompt.":"Cambia identità e strategia senza riscrivere il prompt."}</p></div><Status value="active"/></div><div className="grid2"><label>{en?"Bot name":"Nome bot"}<input value={botName} onChange={e=>setBotName(e.target.value)} readOnly={demo} placeholder="XAU Machine"/></label><label>{en?"Strategy number":"Numero strategia"}<input value={strategy} onChange={e=>setStrategy(e.target.value)} readOnly={demo} placeholder="1"/></label></div><label>{en?"Prompt template":"Template del prompt"}<textarea value={content} onChange={e=>setContent(e.target.value)} readOnly={demo}/></label><div className="successNote"><b>{en?"Live preview":"Anteprima applicata"}</b><br/>{resolved.slice(0,500)}</div><div className="uploadInline"><FileText/><span><b>{en?"Add TXT file":"Aggiungi file TXT"}</b><small>{en?"Use {{BOT_NAME}} and {{STRATEGY_NUMBER}} as variables.":"Usa {{BOT_NAME}} e {{STRATEGY_NUMBER}} come variabili."}</small></span><label className="secondary small">{en?"Choose file":"Scegli file"}<input type="file" accept=".txt,text/plain" hidden onChange={importTxt} disabled={demo}/></label></div><div className="securityNote"><ShieldCheck/><div><b>{en?"Screenshot recognition: not verified":"Riconoscimento screenshot: non verificato"}</b><p>{en?"This audit did not find a proven image-classification path. The CRM no longer presents it as operational.":"Questo controllo non ha trovato un percorso di classificazione immagini verificato. Il CRM non lo presenta più come operativo."}</p></div></div>{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}<div className="editorActions"><button className="primary" disabled={demo} onClick={savePrompt}>{en?"Save and activate":"Salva e attiva"}</button></div></div></div>}
function Materials({locale,tenant,demo}:{locale:Locale;tenant:Tenant|null;demo:boolean}){const en=locale==="en";const [uploads,setUploads]=useState<UploadRow[]>([]);const [loading,setLoading]=useState(!demo);const [error,setError]=useState("");useEffect(()=>{if(demo||!tenant){setLoading(false);return;}const load=async()=>{const client=getSupabase();if(!client)return;const result=await client.from("crm_uploads").select("id,kind,name,mime_type,size_bytes,processing_status,created_at").eq("tenant_id",tenant.id).order("created_at",{ascending:false});if(result.error)setError(result.error.message);else setUploads((result.data||[]) as UploadRow[]);setLoading(false);};void load();},[demo,tenant]);const visible=demo?[{id:"demo-material-1",kind:"guide",name:en?"Bot installation guide":"Guida installazione bot",mime_type:"application/pdf",size_bytes:124000,processing_status:"ready",created_at:new Date(0).toISOString()},{id:"demo-material-2",kind:"prompt",name:en?"Leonardo sales prompt":"Prompt commerciale Leonardo",mime_type:"text/plain",size_bytes:32000,processing_status:"ready",created_at:new Date(0).toISOString()}]:uploads;return <><div className="pageIntro"><div><h2>{en?"Central library":"Libreria centrale"}</h2><p>{en?"Only files actually registered in CRM storage are listed.":"Sono elencati soltanto i file realmente registrati nell’archivio CRM."}</p></div><a className="primary small" href={SIGNAL_ROOM_URL} target="_blank" rel="noreferrer">{en?"Telegram signal room":"Sala segnali Telegram"}</a></div>{loading?<div className="loadingCard">{en?"Loading…":"Caricamento…"}</div>:error?<div className="error">{error}</div>:visible.length===0?<div className="emptyState"><FileText/><h3>{en?"No materials uploaded":"Nessun materiale caricato"}</h3><p>{en?"The previous cards were placeholders and have been removed from the live CRM.":"Le vecchie schede erano segnaposto e sono state rimosse dal CRM reale."}</p></div>:<div className="cardGrid">{visible.map(upload=><Material key={upload.id} locale={locale} upload={upload}/>)}</div>}</>}
function Material({locale,upload}:{locale:Locale;upload:UploadRow}){const type=upload.mime_type?.split("/").at(-1)?.toUpperCase()||upload.kind.toUpperCase();return <div className="material"><FileText/><span className="lang">{type}</span><h3>{upload.name}</h3><p>{upload.processing_status} · {upload.size_bytes?`${Math.ceil(upload.size_bytes/1024)} KB`:"—"}</p><button className="secondary small" disabled>{locale==="en"?"Storage link not exposed":"Link archivio non esposto"}</button></div>}
const integrationCatalog = [
  {provider:"telegram",name:"Telegram Bot",status:"Attivo",desc:"Bot clienti e notifiche",fields:[["bot_token","Token BotFather","password"],["admin_chat_id","Chat ID amministratore","text"]]},
  {provider:"openai",name:"OpenAI / ChatGPT",status:"Da configurare",desc:"Luna principale + Terra escalation",fields:[["api_key","API key OpenAI","password"],["primary_model","Modello principale","text"],["escalation_model","Modello escalation","text"],["escalation_percentage","Uso massimo Terra (%)","number"],["monthly_budget_eur","Budget mensile (€)","number"]]},
  {provider:"puprime",name:"PU Prime",status:"Worker VPS",desc:"Tre IB e clienti",fields:[["email","Email portale","email"],["password","Password portale","password"]]},
] as const;

function Integrations({locale,tenant,demo}:{locale:Locale;tenant:Tenant|null;demo:boolean}){
  const en=locale==="en";
  const [selected,setSelected]=useState<(typeof integrationCatalog)[number]|null>(null); const [values,setValues]=useState<Record<string,string>>({}); const [saving,setSaving]=useState(false); const [notice,setNotice]=useState(""); const [configured,setConfigured]=useState<Record<string,boolean>>({telegram:demo});
  useEffect(()=>{if(!tenant||demo)return;const client=getSupabase();if(!client)return;client.from("crm_integrations").select("provider,connection_status,enabled").eq("tenant_id",tenant.id).then((result:{data:Array<{provider:string;connection_status:string;enabled:boolean}>|null})=>setConfigured(Object.fromEntries((result.data||[]).map(row=>[row.provider,row.enabled&&row.connection_status==="configured"]))));},[tenant,demo]);
  const save=async(e:FormEvent)=>{e.preventDefault();if(!tenant||demo||!selected)return;const client=getSupabase();if(!client)return;setSaving(true);setNotice("");
    const secretKeys=selected.provider==="openai"?["api_key"]:selected.provider==="telegram"?["bot_token"]:selected.provider==="puprime"?["email","password"]:[];
    for(const key of secretKeys){const secret=values[key];if(!secret)continue;const {error}=await client.rpc("crm_set_integration_secret",{p_tenant_id:tenant.id,p_provider:selected.provider,p_key:key,p_secret:secret});if(error){setNotice(`Errore: ${error.message}`);setSaving(false);return;}}
    const publicConfig=selected.provider==="openai"?{primary_model:values.primary_model,escalation_model:values.escalation_model,escalation_percentage:Number(values.escalation_percentage),monthly_budget_eur:Number(values.monthly_budget_eur),budget_alert_levels:[80,95],hard_stop_at_percent:100}:selected.provider==="telegram"?{admin_chat_id:values.admin_chat_id||null}:{};
    const {error:configError}=await client.from("crm_integrations").upsert({tenant_id:tenant.id,provider:selected.provider,display_name:selected.name,enabled:true,connection_status:"configured",public_config:publicConfig,updated_at:new Date().toISOString()},{onConflict:"tenant_id,provider"});
    if(configError){setNotice(`Errore: ${configError.message}`);setSaving(false);return;}setConfigured(current=>({...current,[selected.provider]:true}));setNotice("Configurazione salvata. Le credenziali sono cifrate nel Vault.");setValues({});setSaving(false);};
  return <><div className="securityNote"><ShieldCheck/><div><b>{en?"Protected credentials store":"Archivio credenziali protetto"}</b><p>{en?"Sensitive values are encrypted in Supabase Vault and are never returned to the browser.":"I valori sensibili vengono cifrati in Supabase Vault e non sono mai restituiti al browser."}</p></div></div><div className="botModes"><div><Sparkles/><span><b>GPT‑5.6 Luna</b><small>{en?"Default for every conversation":"Principale per tutte le conversazioni"}</small></span><Status value="active"/></div><div><Activity/><span><b>GPT‑5.6 Terra</b><small>{en?"Automatic escalation · max 20%":"Escalation automatica · massimo 20%"}</small></span><Status value="active"/></div><div><CircleDollarSign/><span><b>{en?"Monthly limit":"Limite mensile"}</b><small>€300 · {en?"alerts at 80% and 95%, automatic stop at 100%":"avvisi all’80% e 95%, blocco automatico al 100%"}</small></span><Status value="active"/></div></div><div className="cardGrid integrations">{integrationCatalog.map((item,i)=><div className="integration" key={item.provider}><div className="integrationIcon">{i===0?<Bot/>:<Plug/>}</div><div><h3>{item.name}</h3><p>{item.desc}</p></div><Status value={configured[item.provider]?"active":"not_configured"}/><button className="secondary small" disabled={demo} onClick={()=>{setSelected(item);setNotice("");setValues(item.provider==="openai"?{primary_model:"gpt-5.6-luna",escalation_model:"gpt-5.6-terra",escalation_percentage:"20",monthly_budget_eur:"300"}:{});}}>{en?"Configure":"Configura"}</button></div>)}</div>{selected&&<div className="modalBackdrop" onClick={()=>setSelected(null)}><form className="modal" onSubmit={save} onClick={e=>e.stopPropagation()}><div className="panelHead"><div><h2>{selected.name}</h2><p>{en?"One OpenAI key enables both models. Values are hidden after saving.":"Una sola chiave OpenAI abilita entrambi i modelli. Dopo il salvataggio i valori non saranno più visibili."}</p></div><button type="button" className="iconBtn" onClick={()=>setSelected(null)}><X/></button></div>{selected.fields.map(([key,label,type])=><label key={key}>{label}<input type={type} value={values[key]||""} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} required autoComplete="off" readOnly={selected.provider==="openai"&&(key==="primary_model"||key==="escalation_model")}/></label>)}{selected.provider==="openai"&&<div className="successNote">{en?"Luna handles routine chats. Terra is used only for difficult objections, high-value leads or low-confidence replies. The monthly budget is capped at €300.":"Luna gestisce le chat normali. Terra interviene solo per obiezioni difficili, lead di valore o risposte con bassa sicurezza. Il budget mensile è limitato a 300 €."}</div>}{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}<div className="editorActions"><button type="button" className="secondary" onClick={()=>setSelected(null)}>{en?"Cancel":"Annulla"}</button><button className="primary" disabled={saving}>{saving?(en?"Saving…":"Salvataggio…"):(en?"Save to Vault":"Salva nel Vault")}</button></div></form></div>}</>}

function WhiteLabelBots({locale,tenant,bots,onChange,demo}:{locale:Locale;tenant:Tenant|null;bots:TenantBot[];onChange:(bots:TenantBot[])=>void;demo:boolean}){
  const en=locale==="en";
  const [open,setOpen]=useState(false);
  const [form,setForm]=useState({name:"",username:"",token:"",adminChatId:"",language:"it"});
  const [saving,setSaving]=useState(false);
  const [notice,setNotice]=useState("");
  const configure=async(e:FormEvent)=>{
    e.preventDefault(); if(!tenant||demo)return;
    const client=getSupabase(); if(!client)return;
    setSaving(true); setNotice("");
    const {data,error}=await client.rpc("crm_configure_tenant_bot",{
      p_tenant_id:tenant.id,p_name:form.name,p_username:form.username,p_bot_token:form.token,
      p_admin_chat_id:form.adminChatId||null,p_default_language:form.language,
    });
    if(error){setNotice(`Errore: ${error.message}`);setSaving(false);return;}
    const saved=Array.isArray(data)?data[0]:data;
    if(saved){
      const bot:TenantBot={...saved,last_tested_at:null,last_error:null};
      onChange([...bots.filter(item=>item.id!==bot.id&&item.username!==bot.username),bot]);
    }
    setForm({name:"",username:"",token:"",adminChatId:"",language:"it"});
    setSaving(false); setOpen(false);
  };
  return <>
    <div className="pageIntro"><div><h2>{en?"Custom Telegram bots":"Bot Telegram personalizzati"}</h2><p>{en?"Each B2B client connects their own BotFather bot. Name, username, image and conversations remain exclusive to their brand.":"Ogni cliente B2B collega il proprio bot creato con BotFather. Nome, username, immagine e conversazioni restano associati esclusivamente al suo brand."}</p></div><button className="primary small" disabled={demo} onClick={()=>{setOpen(true);setNotice("");}}>+ {en?"Connect client bot":"Collega bot cliente"}</button></div>
    <div className="securityNote"><ShieldCheck/><div><b>Un token diverso per ogni azienda</b><p>Il token viene cifrato nel Vault. Il browser non può rileggerlo e gli altri clienti non possono vedere bot, chat o dati di questo tenant.</p></div></div>
    <div className="botModes"><div><Bot/><span><b>White label</b><small>Brand, username e foto del cliente</small></span><Status value="active"/></div><div><Building2/><span><b>Motore centralizzato</b><small>Stesso codice, aggiornamenti e CRM gestiti da noi</small></span><Status value="active"/></div><div><ShieldCheck/><span><b>Dati isolati</b><small>Lead, chat e integrazioni separati per tenant</small></span><Status value="active"/></div></div>
    <div className="cardGrid botCards">{bots.length===0?<div className="emptyState botEmpty"><Bot/><h3>Nessun bot collegato</h3><p>Crea un bot con BotFather e inserisci qui token e username. Dopo il provisioning lo stato passerà da configurato a online.</p><button className="secondary small" disabled={demo} onClick={()=>setOpen(true)}>Collega il primo bot</button></div>:bots.map(bot=><div className="tenantCard" key={bot.id}><div className="brandMark"><Bot/></div><div><h3>{bot.name}</h3><p>{bot.username||"Username da verificare"} · {bot.default_language.toUpperCase()}</p></div><Status value={bot.status}/><div className="miniStats"><span><b>{bot.mode==="white_label"?"White label":"Condiviso"}</b> modalità</span><span><b>{bot.admin_chat_id?"Sì":"No"}</b> notifiche admin</span><span><b>{bot.status==="active"?"Online":"Da avviare"}</b> runtime</span></div>{bot.last_error&&<div className="botError">{bot.last_error}</div>}</div>)}</div>
    <div className="provisionNote"><Activity/><div><b>Stati operativi</b><p><strong>Configurato</strong>: token salvato. <strong>Online</strong>: worker dedicato avviato e webhook verificato. Il CRM non mostra mai il token dopo il salvataggio.</p></div></div>
    {open&&<div className="modalBackdrop" onClick={()=>setOpen(false)}><form className="modal" onSubmit={configure} onClick={e=>e.stopPropagation()}><div className="panelHead"><div><h2>Collega bot white label</h2><p>Il cliente crea il bot su BotFather; qui colleghiamo il suo brand al tenant.</p></div><button type="button" className="iconBtn" onClick={()=>setOpen(false)}><X/></button></div><label>Nome del brand / bot<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="es. Leo Trading Support" required/></label><label>Username Telegram<input value={form.username} onChange={e=>setForm(v=>({...v,username:e.target.value}))} placeholder="@LeoTradingSupportBot" required/></label><label>Token BotFather<input type="password" value={form.token} onChange={e=>setForm(v=>({...v,token:e.target.value}))} placeholder="123456789:AA…" autoComplete="off" required/></label><label>Chat ID amministratore (facoltativo)<input value={form.adminChatId} onChange={e=>setForm(v=>({...v,adminChatId:e.target.value}))} placeholder="Canale notifiche operatore"/></label><label>Lingua predefinita<select value={form.language} onChange={e=>setForm(v=>({...v,language:e.target.value}))}><option value="it">Italiano</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="ru">Русский</option><option value="ar">العربية</option><option value="zh">中文</option><option value="no">Norsk</option></select></label>{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}<div className="editorActions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Annulla</button><button className="primary" disabled={saving}>{saving?"Cifratura…":"Salva e prepara bot"}</button></div></form></div>}
  </>;
}
function Tenants({locale,current}:{locale:Locale;current:Tenant|null}){const en=locale==="en";return <><div className="pageIntro"><div><h2>{en?"Clients and environments":"Clienti e ambienti"}</h2><p>{en?"Only the current real tenant is shown. Automated tenant creation is not enabled.":"È mostrato soltanto il tenant reale corrente. La creazione automatica di nuovi clienti non è ancora abilitata."}</p></div><button className="secondary small" disabled>{en?"Creation not active":"Creazione non attiva"}</button></div><div className="tenantCards"><div className="tenantCard"><div className="brandMark">X</div><div><h3>{current?.name||"CRM"}</h3><p>{current?.slug} · {en?"Plan":"Piano"} {current?.plan_code}</p></div><Status value={current?.status||"active"}/><div className="miniStats"><span><b>{current?.role||"owner"}</b> {en?"role":"ruolo"}</span><span><b>{current?.plan_code||"—"}</b> {en?"plan":"piano"}</span><span><b>Live</b> {en?"environment":"ambiente"}</span></div></div></div></>}
function Billing({locale,tenant,bots,demo}:{locale:Locale;tenant:Tenant|null;bots:TenantBot[];demo:boolean}){const en=locale==="en";const activeBots=demo?4:bots.filter(bot=>bot.status==="active").length;return <><div className="stats"><Stat label={en?"Current plan":"Piano attuale"} value={tenant?.plan_code.toUpperCase()||"FULL"} delta={en?"Tenant configuration":"Configurazione tenant"} icon={<CreditCard/>}/><Stat label={en?"Status":"Stato"} value={tenant?.status||"active"} delta={en?"Account status":"Stato account"} icon={<ShieldCheck/>}/><Stat label={en?"Active Telegram bots":"Bot Telegram attivi"} value={String(activeBots)} delta={en?"Database":"Database"} icon={<Bot/>}/><Stat label={en?"AI this month":"AI questo mese"} value={demo?"€146":"—"} delta={en?"Cost meter not connected":"Contatore costi non collegato"} icon={<Sparkles/>}/></div><Panel title={en?"SaaS plans":"Piani SaaS"}><div className="emptyState"><CreditCard/><h3>{en?"Billing is not active":"Fatturazione non attiva"}</h3><p>{en?"No payment provider is connected yet.":"Non è ancora collegato un fornitore di pagamenti."}</p></div></Panel></>}
function SettingsPage({locale,demo}:{locale:Locale;demo:boolean}){const en=locale==="en";return <div className="settingsGrid"><Panel title={en?"Brand and profile":"Brand e profilo"}><label>{en?"Company name":"Nome azienda"}<input defaultValue="XAU Machine" readOnly/></label><label>{en?"Administrator email":"Email amministratore"}<input type="email" defaultValue="infogaetano@yahoo.it" readOnly/></label><label>{en?"Default language":"Lingua predefinita"}<select disabled><option>Italiano</option><option>English</option></select></label><button className="secondary small" disabled>{en?"Editing not active":"Modifica non attiva"}</button></Panel><Panel title={en?"Security and access":"Sicurezza e accessi"}><div className="settingRow"><span><b>{en?"Tenant isolation":"Isolamento tenant"}</b><small>Row Level Security</small></span><Status value="active"/></div><div className="settingRow"><span><b>Demo</b><small>{en?"Read only":"Sola lettura"}</small></span><Status value="active"/></div><div className="settingRow"><span><b>Audit log</b><small>{en?"Not verified in this audit":"Non verificato in questo controllo"}</small></span><Status value="pending"/></div><button className="secondary small" disabled>{en?"Team management not active":"Gestione team non attiva"}</button></Panel></div>}
