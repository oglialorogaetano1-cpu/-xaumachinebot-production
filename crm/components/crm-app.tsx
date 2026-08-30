"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity, BarChart3, BellRing, Bot, Building2, ChartNoAxesCombined, CircleDollarSign,
  ChevronLeft, CreditCard, FileText, Gauge, Languages, LayoutDashboard, LogOut, Menu,
  MessageCircle, Plug, Search, Settings, ShieldCheck, Sparkles, Users, Workflow, X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { demoCampaigns, demoConversations, demoLeads } from "@/lib/demo";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type Lead = { id: string; full_name: string | null; language: string; status: string; first_source: string; deposit_total: number; rebate_total: number; puprime_status: string };
type Campaign = { id: string; name: string; language: string; source_channel: string | null; deep_link_code: string | null; active: boolean };
type Tenant = { id: string; slug: string; name: string; status: string; plan_code: string; role?: string };
type TenantBot = { id: string; name: string; username: string | null; mode: string; status: string; admin_chat_id: string | null; default_language: string; last_tested_at: string | null; last_error: string | null };
type DemoConversation = (typeof demoConversations)[number];
type PageKey = "vision"|"dashboard"|"leads"|"conversations"|"followups"|"handoffs"|"campaigns"|"puprime"|"mt5"|"economics"|"prompt"|"materials"|"integrations"|"bots"|"tenants"|"billing"|"settings";

const nav: Array<{ key: PageKey; label: string; icon: typeof Gauge }> = [
  { key:"vision", label:"B2B Vision Demo", icon:Gauge },
  { key:"dashboard", label:"Panoramica", icon:LayoutDashboard }, { key:"leads", label:"Lead e pipeline", icon:Users },
  { key:"conversations", label:"Conversazioni", icon:MessageCircle }, { key:"followups", label:"Follow-up", icon:Workflow },
  { key:"handoffs", label:"Intervento umano", icon:BellRing }, { key:"campaigns", label:"Campagne e lingue", icon:Languages },
  { key:"puprime", label:"PU Prime", icon:ShieldCheck }, { key:"mt5", label:"MT5 e risultati", icon:ChartNoAxesCombined },
  { key:"economics", label:"Costi, CPA e rebate", icon:CircleDollarSign }, { key:"prompt", label:"Prompt AI", icon:Sparkles },
  { key:"materials", label:"Materiali e guide", icon:FileText }, { key:"integrations", label:"Integrazioni", icon:Plug },
  { key:"bots", label:"Bot white label", icon:Bot },
  { key:"tenants", label:"Clienti CRM", icon:Building2 }, { key:"billing", label:"Piani e licenze", icon:CreditCard },
  { key:"settings", label:"Impostazioni", icon:Settings },
];

const eur = new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR", maximumFractionDigits:0 });

export default function CrmApp() {
  const params = useSearchParams();
  const [demo, setDemo] = useState(params.get("demo") === "1");
  const [session, setSession] = useState<Session | null>(null);
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
    const { data: listener } = supabase.auth.onAuthStateChange((_event: AuthChangeEvent, value: Session | null) => setSession(value));
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
          supabase.from("crm_leads").select("id,full_name,language,status,first_source,deposit_total,rebate_total,puprime_status").eq("tenant_id", current.id).order("created_at", { ascending:false }).limit(100),
          supabase.from("crm_campaigns").select("id,name,language,source_channel,deep_link_code,active").eq("tenant_id", current.id).order("name"),
          supabase.from("crm_tenant_bots").select("id,name,username,mode,status,admin_chat_id,default_language,last_tested_at,last_error").eq("tenant_id", current.id).order("created_at"),
        ]);
        setLeads((leadRes.data || []) as Lead[]); setCampaigns((campaignRes.data || []) as Campaign[]); setBots((botRes.data || []) as TenantBot[]);
      }
      setLoading(false);
    };
    load();
  }, [demo, session]);

  if (!authReady) return <div className="loading">Connessione sicura…</div>;
  if (!demo && !session) return <Login onDemo={() => setDemo(true)} />;

  const active = nav.find(item => item.key === page)!;
  const title = active.label;
  const closeAndSet = (key: PageKey) => { setPage(key); setMenu(false); };
  const signOut = async () => { if (demo) { setDemo(false); return; } await getSupabase()?.auth.signOut(); };

  return <div className="shell">
    <aside className={menu ? "sidebar open" : "sidebar"}>
      <div className="brand"><div className="brandMark">X</div><div><strong>XAU MACHINE</strong><small>CRM · SaaS</small></div><button className="iconBtn closeMenu" onClick={()=>setMenu(false)} aria-label="Chiudi"><X/></button></div>
      <div className="tenant"><span className="liveDot"/><div><b>{tenant?.name || "CRM"}</b><small>{tenant?.plan_code.toUpperCase()} · {tenant?.role || "viewer"}</small></div></div>
      <nav>{nav.map(item => <button key={item.key} className={page===item.key?"navItem active":"navItem"} onClick={()=>closeAndSet(item.key)}><item.icon/><span>{item.label}</span>{item.key==="handoffs"&&<em>1</em>}</button>)}</nav>
      <button className="navItem signout" onClick={signOut}><LogOut/><span>{demo?"Esci dalla demo":"Disconnetti"}</span></button>
    </aside>
    {menu && <button className="scrim" onClick={()=>setMenu(false)} aria-label="Chiudi menu"/>}
    <main>
      <header><button className="iconBtn mobileMenu" onClick={()=>setMenu(true)}><Menu/></button><div><p>XAU Machine / {title}</p><h1>{title}</h1></div><div className="headerActions"><span className={demo?"mode demo":"mode"}>{demo?"DEMO":"LIVE"}</span><button className="iconBtn"><BellRing/></button><div className="avatar">GO</div></div></header>
      {demo && <div className="demoBanner"><b>Modalità demo in sola lettura.</b> I dati sono dimostrativi e non rappresentano clienti reali.</div>}
      <section className="content">{loading ? <div className="loadingCard">Aggiornamento dati…</div> : <Page page={page} onNavigate={setPage} leads={leads} campaigns={campaigns} bots={bots} onBotsChange={setBots} tenant={tenant} demo={demo}/>}</section>
    </main>
  </div>;
}

function Login({ onDemo }:{onDemo:()=>void}) {
  const [email,setEmail]=useState("infogaetano@yahoo.it"); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");const client=getSupabase();if(!client){setError("Configurazione Supabase mancante.");setBusy(false);return;}const {error:err}=await client.auth.signInWithPassword({email,password});if(err)setError(err.message);setBusy(false);};
  return <main className="loginPage"><div className="loginGlow"/><form className="loginCard" onSubmit={submit}><div className="loginLogo">X</div><p className="eyebrow">XAU MACHINE</p><h1>Il centro operativo<br/>del tuo business.</h1><p className="muted">Lead, conversazioni, follow-up, PU Prime, MT5 e campagne in un’unica piattaforma.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy?"Accesso…":"Accedi al CRM"}</button><button type="button" className="secondary" onClick={onDemo}>Apri demo in sola lettura</button><small>Accesso protetto · Dati isolati per cliente</small></form></main>;
}

function Page({page,onNavigate,leads,campaigns,bots,onBotsChange,tenant,demo}:{page:PageKey;onNavigate:(page:PageKey)=>void;leads:Lead[];campaigns:Campaign[];bots:TenantBot[];onBotsChange:(bots:TenantBot[])=>void;tenant:Tenant|null;demo:boolean}) {
  switch(page){
    case "vision": return <B2BVision leads={leads} campaigns={campaigns} onNavigate={onNavigate}/>;
    case "dashboard": return <Dashboard leads={leads} campaigns={campaigns}/>;
    case "leads": return <Leads leads={leads}/>;
    case "campaigns": return <Campaigns campaigns={campaigns}/>;
    case "conversations": return <Conversations leads={leads} demo={demo}/>;
    case "followups": return <Followups/>;
    case "handoffs": return <Handoffs/>;
    case "puprime": return <PuPrime leads={leads}/>;
    case "mt5": return <Mt5/>;
    case "economics": return <Economics leads={leads}/>;
    case "prompt": return <Prompt demo={demo}/>;
    case "materials": return <Materials demo={demo}/>;
    case "integrations": return <Integrations tenant={tenant} demo={demo}/>;
    case "bots": return <WhiteLabelBots tenant={tenant} bots={bots} onChange={onBotsChange} demo={demo}/>;
    case "tenants": return <Tenants current={tenant}/>;
    case "billing": return <Billing tenant={tenant}/>;
    case "settings": return <SettingsPage demo={demo}/>;
  }
}

function B2BVision({leads,campaigns,onNavigate}:{leads:Lead[];campaigns:Campaign[];onNavigate:(page:PageKey)=>void}){
  const deposits=leads.reduce((sum,lead)=>sum+Number(lead.deposit_total||0),0);
  const rebates=leads.reduce((sum,lead)=>sum+Number(lead.rebate_total||0),0);
  const verified=leads.filter(lead=>lead.puprime_status==="verified").length;
  const conversion=Math.round(verified/Math.max(leads.length,1)*100);
  return <>
    <div className="visionHero"><div><span className="visionBadge">DEMO COMMERCIALE · DATI SIMULATI</span><h2>Mostra al cliente tutto il valore del CRM, in pochi secondi.</h2><p>Lead, conversazioni bilingui, automazioni, PU Prime, MT5, costi e bot white label in una vista completa e credibile.</p><div className="visionActions"><button className="primary bigAction" onClick={()=>onNavigate("conversations")}><MessageCircle/> Apri conversazioni</button><button className="secondary bigAction" onClick={()=>onNavigate("leads")}><Users/> Esplora i lead</button><button className="secondary bigAction" onClick={()=>onNavigate("bots")}><Bot/> Vedi white label</button></div></div><div className="visionScore"><small>Conversione demo</small><strong>{conversion}%</strong><span>Lead → cliente verificato</span><i><b style={{width:`${conversion}%`}}/></i></div></div>
    <div className="stats visionStats"><Stat label="Lead acquisiti" value={String(leads.length)} delta="+18% ultimi 30 giorni" icon={<Users/>}/><Stat label="Depositi attribuiti" value={eur.format(deposits)} delta="Tutti i canali" icon={<CircleDollarSign/>}/><Stat label="Rebate generati" value={eur.format(rebates)} delta="Riepilogo 3 IB" icon={<Activity/>}/><Stat label="Chat aperte" value={String(demoConversations.length)} delta="Italiano + English" icon={<MessageCircle/>}/></div>
    <div className="grid2 visionGrid"><Panel title="Funnel commerciale B2B" action="DATI DEMO"><Pipeline leads={leads}/><button className="panelCta" onClick={()=>onNavigate("followups")}>Gestisci follow-up <Workflow/></button></Panel><Panel title="Conversazioni recenti" action="LIVE DEMO"><div className="visionChats">{demoConversations.slice(0,5).map(chat=><button key={chat.id} onClick={()=>onNavigate("conversations")}><div className="avatar smallAvatar">{chat.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{chat.name}</b><small>{chat.messages.at(-1)?.text}</small></span><em className={`langPill ${chat.language}`}>{chat.language.toUpperCase()}</em>{chat.unread>0&&<i>{chat.unread}</i>}</button>)}</div></Panel></div>
    <div className="grid2"><Panel title="Canali e campagne" action={`${campaigns.length} ATTIVE`}><div className="channelLeaderboard">{[["Leo Italia","IT",38,"€ 19,40"],["LeoTrading English","EN",31,"€ 24,10"],["Alice Trading","IT",24,"€ 21,80"],["New Zealand","EN",19,"€ 27,30"]].map(([name,language,leadsCount,cpa],index)=><div key={String(name)}><b>{index+1}</b><span><strong>{name}</strong><small>{language} · Telegram</small></span><em>{leadsCount} lead</em><i>{cpa} CPA</i></div>)}</div><button className="panelCta" onClick={()=>onNavigate("campaigns")}>Apri performance canali <BarChart3/></button></Panel><Panel title="Stato piattaforma" action="OPERATIVA"><SystemStatus/><div className="visionSystemActions"><button className="secondary" onClick={()=>onNavigate("integrations")}>Configura integrazioni</button><button className="primary" onClick={()=>onNavigate("handoffs")}>Interventi umani</button></div></Panel></div>
  </>;
}

function Dashboard({leads,campaigns}:{leads:Lead[];campaigns:Campaign[]}) {
  const deposits=leads.reduce((s,l)=>s+Number(l.deposit_total||0),0), rebates=leads.reduce((s,l)=>s+Number(l.rebate_total||0),0), active=leads.filter(l=>l.status==="active").length;
  return <><div className="stats"><Stat label="Lead totali" value={String(leads.length)} delta="+12% vs periodo" icon={<Users/>}/><Stat label="Depositi attribuiti" value={eur.format(deposits)} delta="PU Prime" icon={<CircleDollarSign/>}/><Stat label="Rebate" value={eur.format(rebates)} delta="3 IB" icon={<Activity/>}/><Stat label="Clienti attivi" value={String(active)} delta={`${campaigns.length} campagne`} icon={<ShieldCheck/>}/></div><div className="grid2"><Panel title="Pipeline commerciale" action="Apri lead"><Pipeline leads={leads}/></Panel><Panel title="Attività in tempo reale" action="Tutto regolare"><Timeline/></Panel></div><div className="grid2"><Panel title="Canali migliori" action="CPA e conversione"><Bars campaigns={campaigns}/></Panel><Panel title="Stato sistemi" action="Monitor live"><SystemStatus/></Panel></div></>;
}

function Stat({label,value,delta,icon}:{label:string;value:string;delta:string;icon:React.ReactNode}){return <div className="stat"><div className="statIcon">{icon}</div><p>{label}</p><strong>{value}</strong><small>{delta}</small></div>}
function Panel({title,action,children}:{title:string;action?:string;children:React.ReactNode}){return <div className="panel"><div className="panelHead"><h2>{title}</h2>{action&&<span>{action}</span>}</div>{children}</div>}
function Pipeline({leads}:{leads:Lead[]}){const steps=["new","conversation","registration","ib_verification","active"];return <div className="pipeline">{steps.map((s,i)=><div key={s}><span>{["Nuovi","In chat","Registrazione","Verifica IB","Attivi"][i]}</span><b>{leads.filter(l=>l.status===s).length}</b><i style={{width:`${Math.max(8,leads.filter(l=>l.status===s).length/Math.max(1,leads.length)*100)}%`}}/></div>)}</div>}
function Timeline(){return <div className="timeline"><div><i/><b>Nuovo lead acquisito</b><small>Leo Italia · adesso</small></div><div><i/><b>Controllo PU Prime completato</b><small>3 IB · 18 min fa</small></div><div><i/><b>Follow-up programmato</b><small>Assenza 2 ore · 42 min fa</small></div><div><i/><b>Screenshot MT5 disponibile</b><small>Conto master · oggi</small></div></div>}
function Bars({campaigns}:{campaigns:Campaign[]}){return <div className="bars">{campaigns.slice(0,5).map((c,i)=><div key={c.id}><span>{c.name}</span><i><b style={{width:`${88-i*12}%`}}/></i><em>{88-i*12}%</em></div>)}</div>}
function SystemStatus(){return <div className="systems">{[["Telegram","Operativo"],["Supabase","Connesso"],["PU Prime","Worker VPS"],["MT5","Da collegare"],["AI","Chiave richiesta"]].map(([a,b],i)=><div key={a}><span className={i<3?"okDot":"warnDot"}/><b>{a}</b><small>{b}</small></div>)}</div>}

function Leads({leads}:{leads:Lead[]}){return <Panel title="Lead e clienti" action={`${leads.length} risultati`}><div className="toolbar"><div className="search"><Search/><input placeholder="Cerca nome, account o Telegram…"/></div><button className="primary small">+ Nuovo lead</button></div><div className="table"><div className="tr th"><span>Cliente</span><span>Fase</span><span>Lingua</span><span>Deposito</span><span>PU Prime</span></div>{leads.map(l=><div className="tr" key={l.id}><span><b>{l.full_name||"Senza nome"}</b><small>{l.first_source}</small></span><span><Status value={l.status}/></span><span>{l.language.toUpperCase()}</span><span>{eur.format(Number(l.deposit_total||0))}</span><span><Status value={l.puprime_status}/></span></div>)}</div></Panel>}
function Status({value}:{value:string}){return <em className={`status ${value}`}>{value.replaceAll("_"," ")}</em>}
function Campaigns({campaigns}:{campaigns:Campaign[]}){return <><div className="pageIntro"><div><h2>Attribuzione automatica</h2><p>Ogni link Telegram identifica canale, lingua e campagna. Il messaggio di benvenuto parte nella lingua corretta.</p></div><button className="primary small">+ Crea campagna</button></div><div className="cardGrid">{campaigns.map(c=><div className="campaignCard" key={c.id}><div><span className="lang">{c.language.toUpperCase()}</span><Status value={c.active?"active":"paused"}/></div><h3>{c.name}</h3><p>Codice: <b>{c.deep_link_code}</b></p><code>t.me/XauMachineAisupport_bot?start={c.deep_link_code}</code><div className="miniStats"><span><b>0</b> lead</span><span><b>—</b> CPA</span><span><b>0%</b> conv.</span></div></div>)}</div></>}
function Conversations({leads,demo}:{leads:Lead[];demo:boolean}){
  const fallback:DemoConversation={id:"live",leadId:leads[0]?.id||"",name:leads[0]?.full_name||"Conversazione",language:leads[0]?.language||"it",stage:"Telegram",time:"ora",unread:0,messages:[{side:"lead",text:"Seleziona una conversazione per visualizzare i messaggi.",time:"ora"}]};
  const chats=demo?demoConversations:[fallback];
  const [selectedId,setSelectedId]=useState(chats[0]?.id||"");
  const [mobileOpen,setMobileOpen]=useState(false);
  const selected=chats.find(chat=>chat.id===selectedId)||chats[0];
  return <div className={`chatLayout b2bChat ${mobileOpen?"mobileChatOpen":""}`}><div className="chatList"><div className="chatListHead"><b>Inbox</b><span>{chats.reduce((sum,chat)=>sum+chat.unread,0)} da leggere</span></div><div className="search"><Search/><input placeholder="Cerca chat…"/></div><div className="chatFilters"><button className="active">Tutte</button><button>IT</button><button>EN</button><button>Operatore</button></div>{chats.map(chat=><button key={chat.id} onClick={()=>{setSelectedId(chat.id);setMobileOpen(true);}} className={selected?.id===chat.id?"chatRow selected":"chatRow"}><div className="avatar smallAvatar">{chat.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{chat.name}</b><small>{chat.messages.at(-1)?.text}</small><i>{chat.stage}</i></span><em>{chat.time}{chat.unread>0&&<strong>{chat.unread}</strong>}</em></button>)}</div><div className="chatWindow">{selected&&<><div className="chatTop"><button className="iconBtn mobileChatBack" onClick={()=>setMobileOpen(false)} aria-label="Torna alle conversazioni"><ChevronLeft/></button><div className="avatar">{selected.name.split(" ").map(part=>part[0]).slice(0,2).join("")}</div><span><b>{selected.name}</b><small>Telegram · {selected.language==="it"?"Italiano":"English"} · {selected.stage}</small></span><div className="chatTopActions"><button className="secondary">Traduci pagina</button><button className="primary">Intervento umano</button></div></div><div className="messages">{selected.messages.map((message,index)=><div key={index} className={`message ${message.side}`}><small>{message.side==="ai"?"AI Assistant":selected.name}</small><p>{message.text}</p><time>{message.time}</time></div>)}</div><div className="quickActions"><button>Mostra risultati</button><button>Invia guida</button><button>Verifica IB</button><button>Programma follow-up</button></div><div className="composer"><textarea placeholder={demo?"Demo in sola lettura":"Scrivi una risposta…"} readOnly={demo}/><button className="primary" disabled={demo}>Invia</button></div></>}</div></div>;
}
function Followups(){return <><div className="pageIntro"><div><h2>Regole intelligenti per fase</h2><p>L’AI classifica l’esito; il motore applica tempi e condizioni senza invii duplicati.</p></div><button className="primary small">+ Nuova regola</button></div><div className="cardGrid"><Rule name="Assenza 2 ore" trigger="Nessuna risposta" when="Non registrato · nessun cambio IB" text="Avevi altre domande? Posso aiutarti o mostrarti qualche risultato?"/><Rule name="Cambio IB richiesto" trigger="Dopo 3 giorni" when="Cambio IB non confermato" text="Hai ricevuto l’email PU Prime o la conferma nell’area personale?"/><Rule name="Deposito mancante" trigger="Dopo verifica IB" when="IB verificato · deposito 0" text="Account corretto: posso guidarti nel prossimo passaggio."/></div></>}
function Rule({name,trigger,when,text}:{name:string;trigger:string;when:string;text:string}){return <div className="rule"><div><Workflow/><Status value="active"/></div><h3>{name}</h3><b>{trigger}</b><small>{when}</small><p>“{text}”</p><button className="secondary small">Modifica regola</button></div>}
function Handoffs(){return <><div className="stats"><Stat label="Da prendere" value="1" delta="Priorità alta" icon={<BellRing/>}/><Stat label="In gestione" value="0" delta="Operatori" icon={<Users/>}/><Stat label="Tempo medio" value="4 min" delta="Ultimi 7 giorni" icon={<Gauge/>}/><Stat label="Risolte" value="12" delta="Questa settimana" icon={<ShieldCheck/>}/></div><Panel title="Coda operatore"><div className="handoff"><div className="avatar">MR</div><div><b>Marco Rossi</b><p>L’AI richiede aiuto: domanda non gestita sul cambio IB.</p><small>Telegram · Italiano · 2 minuti fa</small></div><Status value="urgent"/><div className="rowActions"><button className="primary small">Prendi in carico</button><button className="secondary small">Chiama</button></div></div></Panel></>}
function PuPrime({leads}:{leads:Lead[]}){const dep=leads.reduce((s,l)=>s+Number(l.deposit_total||0),0),reb=leads.reduce((s,l)=>s+Number(l.rebate_total||0),0);return <><div className="stats"><Stat label="IB 23215978" value="—" delta="Ultima sync" icon={<ShieldCheck/>}/><Stat label="IB 23217421" value="—" delta="Principale" icon={<ShieldCheck/>}/><Stat label="IB 7527073" value="—" delta="Ultima sync" icon={<ShieldCheck/>}/><Stat label="Rebate totali" value={eur.format(reb)} delta={`${eur.format(dep)} depositi`} icon={<CircleDollarSign/>}/></div><Panel title="Verifiche cliente"><div className="table"><div className="tr th"><span>Cliente</span><span>Account</span><span>IB</span><span>Deposito</span><span>Stato</span></div>{leads.map(l=><div className="tr" key={l.id}><span><b>{l.full_name||"Senza nome"}</b></span><span>—</span><span>—</span><span>{eur.format(Number(l.deposit_total||0))}</span><span><Status value={l.puprime_status}/></span></div>)}</div></Panel></>}
function Mt5(){return <><div className="stats"><Stat label="Saldo conto" value="—" delta="MT5 da collegare" icon={<BarChart3/>}/><Stat label="Risultato oggi" value="—" delta="Conto master" icon={<Activity/>}/><Stat label="Settimana" value="—" delta="Aggiornamento live" icon={<ChartNoAxesCombined/>}/><Stat label="Screenshot" value="0" delta="Archivio risultati" icon={<FileText/>}/></div><div className="grid2"><Panel title="Andamento conto"><div className="chartPlaceholder"><ChartNoAxesCombined/><p>Il grafico apparirà dopo il collegamento del worker MT5 sulla VPS.</p></div></Panel><Panel title="Screenshot automatici"><div className="uploadBox"><FileText/><b>Carica il pacchetto worker MT5</b><p>ZIP, guide e script vengono analizzati e versionati.</p><button className="secondary small">Seleziona ZIP</button></div></Panel></div></>}
function Economics({leads}:{leads:Lead[]}){const dep=leads.reduce((s,l)=>s+Number(l.deposit_total||0),0);return <><div className="stats"><Stat label="Spesa advertising" value="€0" delta="Periodo selezionato" icon={<CreditCard/>}/><Stat label="Costo per lead" value="—" delta={`${leads.length} lead`} icon={<Users/>}/><Stat label="Costo per deposito" value="—" delta={eur.format(dep)} icon={<CircleDollarSign/>}/><Stat label="ROAS / rebate" value="—" delta="Collega costo ads" icon={<BarChart3/>}/></div><Panel title="Performance per canale e lingua"><div className="emptyState"><BarChart3/><h3>Attribuzione pronta</h3><p>Inserisci la spesa manualmente o collega la sorgente advertising per calcolare CPL, CPA, deposito medio e rebate per canale e lingua.</p><button className="primary small">Aggiungi costo ads</button></div></Panel></>}
function Prompt({demo}:{demo:boolean}){return <div className="editorLayout"><div className="editorNav"><button className="selected"><Sparkles/> Prompt commerciale <small>Bot XAU</small></button><button><Languages/> Traduzioni <small>12 lingue</small></button><button><ShieldCheck/> Regole e sicurezza <small>Trading</small></button></div><div className="editor"><div className="panelHead"><div><h2>Prompt AI conversazione</h2><p>Versione pubblicata · Italiano</p></div><Status value="active"/></div><textarea defaultValue={"Sei Leonardo, assistente commerciale XAU Machine. Rispondi con testo libero, in modo chiaro e responsabile. Guida il cliente dalla domanda iniziale alla registrazione, verifica IB e deposito..."} readOnly={demo}/><div className="uploadInline"><FileText/><span><b>Aggiungi file TXT</b><small>Italiano o inglese · versionamento automatico</small></span><button className="secondary small" disabled={demo}>Scegli file</button></div><div className="editorActions"><button className="secondary" disabled={demo}>Anteprima</button><button className="primary" disabled={demo}>Salva nuova versione</button></div></div></div>}
function Materials({demo}:{demo:boolean}){return <><div className="pageIntro"><div><h2>Libreria centrale</h2><p>Guide, screenshot, TXT, PDF e ZIP disponibili al chatbot e agli operatori.</p></div><button className="primary small" disabled={demo}>+ Carica materiale</button></div><div className="cardGrid"><Material name="Guida installazione bot" type="PDF" access="Solo dopo verifica IB"/><Material name="Prompt commerciale Leonardo" type="TXT" access="AI + operatori"/><Material name="Worker MT5 e screenshot" type="ZIP" access="Solo amministratori"/><Material name="Risultati giornalieri" type="IMMAGINI" access="Chatbot"/></div></>}
function Material({name,type,access}:{name:string;type:string;access:string}){return <div className="material"><FileText/><span className="lang">{type}</span><h3>{name}</h3><p>{access}</p><button className="secondary small">Apri</button></div>}
const integrationCatalog = [
  {provider:"telegram",name:"Telegram Bot",status:"Attivo",desc:"Bot clienti e notifiche",fields:[["bot_token","Token BotFather","password"],["admin_chat_id","Chat ID amministratore","text"]]},
  {provider:"openai",name:"OpenAI / ChatGPT",status:"Da configurare",desc:"Conversazione AI",fields:[["api_key","API key OpenAI","password"]]},
  {provider:"anthropic",name:"Claude",status:"Errore chiave",desc:"Fallback AI",fields:[["api_key","API key Anthropic","password"]]},
  {provider:"puprime",name:"PU Prime",status:"Worker VPS",desc:"Tre IB e clienti",fields:[["email","Email portale","email"],["password","Password portale","password"]]},
  {provider:"mt5",name:"MetaTrader 5",status:"Da collegare",desc:"Conto master e screenshot",fields:[["login","Login MT5","text"],["investor_password","Password investitore","password"],["server","Server broker","text"]]},
  {provider:"whatsapp",name:"WhatsApp",status:"Da configurare",desc:"QR e follow-up",fields:[["access_token","Access token","password"],["phone_number_id","Phone number ID","text"]]},
  {provider:"ringover",name:"Ringover",status:"Da verificare",desc:"Chiamate operatore",fields:[["api_key","API key Ringover","password"]]},
  {provider:"brevo",name:"Brevo Email",status:"Da configurare",desc:"Email e notifiche",fields:[["api_key","API key Brevo","password"]]},
] as const;

function Integrations({tenant,demo}:{tenant:Tenant|null;demo:boolean}){
  const [selected,setSelected]=useState<(typeof integrationCatalog)[number]|null>(null); const [values,setValues]=useState<Record<string,string>>({}); const [saving,setSaving]=useState(false); const [notice,setNotice]=useState("");
  const save=async(e:FormEvent)=>{e.preventDefault();if(!tenant||demo||!selected)return;const client=getSupabase();if(!client)return;setSaving(true);setNotice("");for(const [key] of selected.fields){const secret=values[key];if(!secret)continue;const {error}=await client.rpc("crm_set_integration_secret",{p_tenant_id:tenant.id,p_provider:selected.provider,p_key:key,p_secret:secret});if(error){setNotice(`Errore: ${error.message}`);setSaving(false);return;}}setNotice("Credenziali salvate nel Vault. I valori non saranno più mostrati.");setValues({});setSaving(false);};
  return <><div className="securityNote"><ShieldCheck/><div><b>Archivio credenziali protetto</b><p>I valori sensibili vengono cifrati in Supabase Vault e non sono mai restituiti al browser.</p></div></div><div className="cardGrid integrations">{integrationCatalog.map((item,i)=><div className="integration" key={item.provider}><div className="integrationIcon">{i===0?<Bot/>:<Plug/>}</div><div><h3>{item.name}</h3><p>{item.desc}</p></div><Status value={item.status==="Attivo"?"active":item.status==="Errore chiave"?"error":"not_configured"}/><button className="secondary small" disabled={demo} onClick={()=>{setSelected(item);setNotice("");setValues({});}}>Configura</button></div>)}</div>{selected&&<div className="modalBackdrop" onClick={()=>setSelected(null)}><form className="modal" onSubmit={save} onClick={e=>e.stopPropagation()}><div className="panelHead"><div><h2>{selected.name}</h2><p>Inserisci i valori: dopo il salvataggio non saranno più visibili.</p></div><button type="button" className="iconBtn" onClick={()=>setSelected(null)}><X/></button></div>{selected.fields.map(([key,label,type])=><label key={key}>{label}<input type={type} value={values[key]||""} onChange={e=>setValues(v=>({...v,[key]:e.target.value}))} required autoComplete="off"/></label>)}{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}<div className="editorActions"><button type="button" className="secondary" onClick={()=>setSelected(null)}>Annulla</button><button className="primary" disabled={saving}>{saving?"Salvataggio…":"Salva nel Vault"}</button></div></form></div>}</>}

function WhiteLabelBots({tenant,bots,onChange,demo}:{tenant:Tenant|null;bots:TenantBot[];onChange:(bots:TenantBot[])=>void;demo:boolean}){
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
    <div className="pageIntro"><div><h2>Bot Telegram personalizzati</h2><p>Ogni cliente B2B collega il proprio bot creato con BotFather. Nome, username, immagine e conversazioni restano associati esclusivamente al suo brand.</p></div><button className="primary small" disabled={demo} onClick={()=>{setOpen(true);setNotice("");}}>+ Collega bot cliente</button></div>
    <div className="securityNote"><ShieldCheck/><div><b>Un token diverso per ogni azienda</b><p>Il token viene cifrato nel Vault. Il browser non può rileggerlo e gli altri clienti non possono vedere bot, chat o dati di questo tenant.</p></div></div>
    <div className="botModes"><div><Bot/><span><b>White label</b><small>Brand, username e foto del cliente</small></span><Status value="active"/></div><div><Building2/><span><b>Motore centralizzato</b><small>Stesso codice, aggiornamenti e CRM gestiti da noi</small></span><Status value="active"/></div><div><ShieldCheck/><span><b>Dati isolati</b><small>Lead, chat e integrazioni separati per tenant</small></span><Status value="active"/></div></div>
    <div className="cardGrid botCards">{bots.length===0?<div className="emptyState botEmpty"><Bot/><h3>Nessun bot collegato</h3><p>Crea un bot con BotFather e inserisci qui token e username. Dopo il provisioning lo stato passerà da configurato a online.</p><button className="secondary small" disabled={demo} onClick={()=>setOpen(true)}>Collega il primo bot</button></div>:bots.map(bot=><div className="tenantCard" key={bot.id}><div className="brandMark"><Bot/></div><div><h3>{bot.name}</h3><p>{bot.username||"Username da verificare"} · {bot.default_language.toUpperCase()}</p></div><Status value={bot.status}/><div className="miniStats"><span><b>{bot.mode==="white_label"?"White label":"Condiviso"}</b> modalità</span><span><b>{bot.admin_chat_id?"Sì":"No"}</b> notifiche admin</span><span><b>{bot.status==="active"?"Online":"Da avviare"}</b> runtime</span></div>{bot.last_error&&<div className="botError">{bot.last_error}</div>}</div>)}</div>
    <div className="provisionNote"><Activity/><div><b>Stati operativi</b><p><strong>Configurato</strong>: token salvato. <strong>Online</strong>: worker dedicato avviato e webhook verificato. Il CRM non mostra mai il token dopo il salvataggio.</p></div></div>
    {open&&<div className="modalBackdrop" onClick={()=>setOpen(false)}><form className="modal" onSubmit={configure} onClick={e=>e.stopPropagation()}><div className="panelHead"><div><h2>Collega bot white label</h2><p>Il cliente crea il bot su BotFather; qui colleghiamo il suo brand al tenant.</p></div><button type="button" className="iconBtn" onClick={()=>setOpen(false)}><X/></button></div><label>Nome del brand / bot<input value={form.name} onChange={e=>setForm(v=>({...v,name:e.target.value}))} placeholder="es. Leo Trading Support" required/></label><label>Username Telegram<input value={form.username} onChange={e=>setForm(v=>({...v,username:e.target.value}))} placeholder="@LeoTradingSupportBot" required/></label><label>Token BotFather<input type="password" value={form.token} onChange={e=>setForm(v=>({...v,token:e.target.value}))} placeholder="123456789:AA…" autoComplete="off" required/></label><label>Chat ID amministratore (facoltativo)<input value={form.adminChatId} onChange={e=>setForm(v=>({...v,adminChatId:e.target.value}))} placeholder="Canale notifiche operatore"/></label><label>Lingua predefinita<select value={form.language} onChange={e=>setForm(v=>({...v,language:e.target.value}))}><option value="it">Italiano</option><option value="en">English</option><option value="es">Español</option><option value="fr">Français</option><option value="de">Deutsch</option><option value="ru">Русский</option><option value="ar">العربية</option><option value="zh">中文</option><option value="no">Norsk</option></select></label>{notice&&<div className={notice.startsWith("Errore")?"error":"successNote"}>{notice}</div>}<div className="editorActions"><button type="button" className="secondary" onClick={()=>setOpen(false)}>Annulla</button><button className="primary" disabled={saving}>{saving?"Cifratura…":"Salva e prepara bot"}</button></div></form></div>}
  </>;
}
function Tenants({current}:{current:Tenant|null}){return <><div className="pageIntro"><div><h2>Clienti e ambienti</h2><p>Ogni azienda vede esclusivamente lead, conversazioni, bot, campagne e integrazioni proprie.</p></div><button className="primary small">+ Nuovo cliente</button></div><div className="tenantCards"><div className="tenantCard"><div className="brandMark">X</div><div><h3>{current?.name}</h3><p>{current?.slug} · Piano {current?.plan_code}</p></div><Status value={current?.status||"active"}/><div className="miniStats"><span><b>Owner</b> ruolo</span><span><b>8</b> moduli</span><span><b>Live</b> ambiente</span></div></div><div className="tenantCard"><div className="brandMark demoMark">D</div><div><h3>XAU Machine Demo</h3><p>demo · Accesso view-only</p></div><Status value="demo"/><div className="miniStats"><span><b>Demo</b> piano</span><span><b>1</b> utente</span><span><b>Finto</b> dataset</span></div></div></div></>}
function Billing({tenant}:{tenant:Tenant|null}){return <><div className="stats"><Stat label="Piano attuale" value={tenant?.plan_code.toUpperCase()||"FULL"} delta="Tutti i moduli" icon={<CreditCard/>}/><Stat label="Stato" value={tenant?.status||"active"} delta="Accesso operativo" icon={<ShieldCheck/>}/><Stat label="Licenze MT5" value="0" delta="Attive" icon={<FileText/>}/><Stat label="AI questo mese" value="€0" delta="Consumo tracciato" icon={<Sparkles/>}/></div><Panel title="Piani SaaS"><div className="planGrid">{[["CRM","Lead, campagne e operatori"],["CRM + AI","Chatbot e follow-up"],["Trading","MT5 e sala segnali"],["Full","PU Prime + tutto"],["White label","Brand personalizzato"]].map(([a,b])=><div key={a}><h3>{a}</h3><p>{b}</p><button className="secondary small">Configura prezzo</button></div>)}</div></Panel></>}
function SettingsPage({demo}:{demo:boolean}){return <div className="settingsGrid"><Panel title="Brand e profilo"><label>Nome azienda<input defaultValue="XAU Machine" readOnly={demo}/></label><label>Email amministratore<input type="email" defaultValue="infogaetano@yahoo.it" readOnly={demo}/></label><label>Lingua predefinita<select disabled={demo}><option>Italiano</option><option>English</option></select></label><button className="primary small" disabled={demo}>Salva</button></Panel><Panel title="Sicurezza e accessi"><div className="settingRow"><span><b>Isolamento tenant</b><small>Row Level Security</small></span><Status value="active"/></div><div className="settingRow"><span><b>Demo</b><small>Sola lettura</small></span><Status value="active"/></div><div className="settingRow"><span><b>Audit log</b><small>Azioni amministratori</small></span><Status value="active"/></div><button className="secondary small">Gestisci team</button></Panel></div>}
