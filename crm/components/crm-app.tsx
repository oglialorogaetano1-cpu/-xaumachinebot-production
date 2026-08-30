"use client";

import { FormEvent, useEffect, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  Activity, BarChart3, BellRing, Bot, Building2, ChartNoAxesCombined, CircleDollarSign,
  CreditCard, FileText, Gauge, Languages, LayoutDashboard, LogOut, Menu,
  MessageCircle, Plug, Search, Settings, ShieldCheck, Sparkles, Users, Workflow, X,
} from "lucide-react";
import { getSupabase } from "@/lib/supabase";
import { demoCampaigns, demoLeads } from "@/lib/demo";
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";

type Lead = { id: string; full_name: string | null; language: string; status: string; first_source: string; deposit_total: number; rebate_total: number; puprime_status: string };
type Campaign = { id: string; name: string; language: string; source_channel: string | null; deep_link_code: string | null; active: boolean };
type Tenant = { id: string; slug: string; name: string; status: string; plan_code: string; role?: string };
type PageKey = "dashboard"|"leads"|"conversations"|"followups"|"handoffs"|"campaigns"|"puprime"|"mt5"|"economics"|"prompt"|"materials"|"integrations"|"tenants"|"billing"|"settings";

const nav: Array<{ key: PageKey; label: string; icon: typeof Gauge }> = [
  { key:"dashboard", label:"Panoramica", icon:LayoutDashboard }, { key:"leads", label:"Lead e pipeline", icon:Users },
  { key:"conversations", label:"Conversazioni", icon:MessageCircle }, { key:"followups", label:"Follow-up", icon:Workflow },
  { key:"handoffs", label:"Intervento umano", icon:BellRing }, { key:"campaigns", label:"Campagne e lingue", icon:Languages },
  { key:"puprime", label:"PU Prime", icon:ShieldCheck }, { key:"mt5", label:"MT5 e risultati", icon:ChartNoAxesCombined },
  { key:"economics", label:"Costi, CPA e rebate", icon:CircleDollarSign }, { key:"prompt", label:"Prompt AI", icon:Sparkles },
  { key:"materials", label:"Materiali e guide", icon:FileText }, { key:"integrations", label:"Integrazioni", icon:Plug },
  { key:"tenants", label:"Clienti CRM", icon:Building2 }, { key:"billing", label:"Piani e licenze", icon:CreditCard },
  { key:"settings", label:"Impostazioni", icon:Settings },
];

const eur = new Intl.NumberFormat("it-IT", { style:"currency", currency:"EUR", maximumFractionDigits:0 });

export default function CrmApp() {
  const params = useSearchParams();
  const [demo, setDemo] = useState(params.get("demo") === "1");
  const [session, setSession] = useState<Session | null>(null);
  const [authReady, setAuthReady] = useState(false);
  const [page, setPage] = useState<PageKey>("dashboard");
  const [menu, setMenu] = useState(false);
  const [tenant, setTenant] = useState<Tenant | null>(demo ? { id:"00000000-0000-4000-8000-000000000002", slug:"demo", name:"XAU Machine Demo", status:"demo", plan_code:"demo", role:"viewer" } : null);
  const [leads, setLeads] = useState<Lead[]>(demoLeads as Lead[]);
  const [campaigns, setCampaigns] = useState<Campaign[]>(demoCampaigns as Campaign[]);
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
        const [leadRes, campaignRes] = await Promise.all([
          supabase.from("crm_leads").select("id,full_name,language,status,first_source,deposit_total,rebate_total,puprime_status").eq("tenant_id", current.id).order("created_at", { ascending:false }).limit(100),
          supabase.from("crm_campaigns").select("id,name,language,source_channel,deep_link_code,active").eq("tenant_id", current.id).order("name"),
        ]);
        setLeads((leadRes.data || []) as Lead[]); setCampaigns((campaignRes.data || []) as Campaign[]);
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
      <section className="content">{loading ? <div className="loadingCard">Aggiornamento dati…</div> : <Page page={page} leads={leads} campaigns={campaigns} tenant={tenant} demo={demo}/>}</section>
    </main>
  </div>;
}

function Login({ onDemo }:{onDemo:()=>void}) {
  const [email,setEmail]=useState("infogaetano@yahoo.it"); const [password,setPassword]=useState(""); const [error,setError]=useState(""); const [busy,setBusy]=useState(false);
  const submit=async(e:FormEvent)=>{e.preventDefault();setBusy(true);setError("");const client=getSupabase();if(!client){setError("Configurazione Supabase mancante.");setBusy(false);return;}const {error:err}=await client.auth.signInWithPassword({email,password});if(err)setError(err.message);setBusy(false);};
  return <main className="loginPage"><div className="loginGlow"/><form className="loginCard" onSubmit={submit}><div className="loginLogo">X</div><p className="eyebrow">XAU MACHINE</p><h1>Il centro operativo<br/>del tuo business.</h1><p className="muted">Lead, conversazioni, follow-up, PU Prime, MT5 e campagne in un’unica piattaforma.</p><label>Email<input type="email" value={email} onChange={e=>setEmail(e.target.value)} required/></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} required/></label>{error&&<div className="error">{error}</div>}<button className="primary" disabled={busy}>{busy?"Accesso…":"Accedi al CRM"}</button><button type="button" className="secondary" onClick={onDemo}>Apri demo in sola lettura</button><small>Accesso protetto · Dati isolati per cliente</small></form></main>;
}

function Page({page,leads,campaigns,tenant,demo}:{page:PageKey;leads:Lead[];campaigns:Campaign[];tenant:Tenant|null;demo:boolean}) {
  switch(page){
    case "dashboard": return <Dashboard leads={leads} campaigns={campaigns}/>;
    case "leads": return <Leads leads={leads}/>;
    case "campaigns": return <Campaigns campaigns={campaigns}/>;
    case "conversations": return <Conversations leads={leads}/>;
    case "followups": return <Followups/>;
    case "handoffs": return <Handoffs/>;
    case "puprime": return <PuPrime leads={leads}/>;
    case "mt5": return <Mt5/>;
    case "economics": return <Economics leads={leads}/>;
    case "prompt": return <Prompt demo={demo}/>;
    case "materials": return <Materials demo={demo}/>;
    case "integrations": return <Integrations/>;
    case "tenants": return <Tenants current={tenant}/>;
    case "billing": return <Billing tenant={tenant}/>;
    case "settings": return <SettingsPage demo={demo}/>;
  }
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
function Conversations({leads}:{leads:Lead[]}){return <div className="chatLayout"><div className="chatList"><div className="search"><Search/><input placeholder="Cerca chat…"/></div>{leads.map((l,i)=><button key={l.id} className={i===0?"chatRow selected":"chatRow"}><div className="avatar smallAvatar">{(l.full_name||"?").slice(0,2).toUpperCase()}</div><span><b>{l.full_name||"Senza nome"}</b><small>{i===0?"Vorrei capire come funziona…":"Conversazione Telegram"}</small></span><em>{i===0?"ora":"ieri"}</em></button>)}</div><div className="chatWindow"><div className="emptyChat"><MessageCircle/><h2>Conversazioni unificate</h2><p>Seleziona una chat per leggere la traduzione, rispondere come operatore o riattivare l’AI.</p><button className="primary small">Apri prima chat</button></div></div></div>}
function Followups(){return <><div className="pageIntro"><div><h2>Regole intelligenti per fase</h2><p>L’AI classifica l’esito; il motore applica tempi e condizioni senza invii duplicati.</p></div><button className="primary small">+ Nuova regola</button></div><div className="cardGrid"><Rule name="Assenza 2 ore" trigger="Nessuna risposta" when="Non registrato · nessun cambio IB" text="Avevi altre domande? Posso aiutarti o mostrarti qualche risultato?"/><Rule name="Cambio IB richiesto" trigger="Dopo 3 giorni" when="Cambio IB non confermato" text="Hai ricevuto l’email PU Prime o la conferma nell’area personale?"/><Rule name="Deposito mancante" trigger="Dopo verifica IB" when="IB verificato · deposito 0" text="Account corretto: posso guidarti nel prossimo passaggio."/></div></>}
function Rule({name,trigger,when,text}:{name:string;trigger:string;when:string;text:string}){return <div className="rule"><div><Workflow/><Status value="active"/></div><h3>{name}</h3><b>{trigger}</b><small>{when}</small><p>“{text}”</p><button className="secondary small">Modifica regola</button></div>}
function Handoffs(){return <><div className="stats"><Stat label="Da prendere" value="1" delta="Priorità alta" icon={<BellRing/>}/><Stat label="In gestione" value="0" delta="Operatori" icon={<Users/>}/><Stat label="Tempo medio" value="4 min" delta="Ultimi 7 giorni" icon={<Gauge/>}/><Stat label="Risolte" value="12" delta="Questa settimana" icon={<ShieldCheck/>}/></div><Panel title="Coda operatore"><div className="handoff"><div className="avatar">MR</div><div><b>Marco Rossi</b><p>L’AI richiede aiuto: domanda non gestita sul cambio IB.</p><small>Telegram · Italiano · 2 minuti fa</small></div><Status value="urgent"/><div className="rowActions"><button className="primary small">Prendi in carico</button><button className="secondary small">Chiama</button></div></div></Panel></>}
function PuPrime({leads}:{leads:Lead[]}){const dep=leads.reduce((s,l)=>s+Number(l.deposit_total||0),0),reb=leads.reduce((s,l)=>s+Number(l.rebate_total||0),0);return <><div className="stats"><Stat label="IB 23215978" value="—" delta="Ultima sync" icon={<ShieldCheck/>}/><Stat label="IB 23217421" value="—" delta="Principale" icon={<ShieldCheck/>}/><Stat label="IB 7527073" value="—" delta="Ultima sync" icon={<ShieldCheck/>}/><Stat label="Rebate totali" value={eur.format(reb)} delta={`${eur.format(dep)} depositi`} icon={<CircleDollarSign/>}/></div><Panel title="Verifiche cliente"><div className="table"><div className="tr th"><span>Cliente</span><span>Account</span><span>IB</span><span>Deposito</span><span>Stato</span></div>{leads.map(l=><div className="tr" key={l.id}><span><b>{l.full_name||"Senza nome"}</b></span><span>—</span><span>—</span><span>{eur.format(Number(l.deposit_total||0))}</span><span><Status value={l.puprime_status}/></span></div>)}</div></Panel></>}
function Mt5(){return <><div className="stats"><Stat label="Saldo conto" value="—" delta="MT5 da collegare" icon={<BarChart3/>}/><Stat label="Risultato oggi" value="—" delta="Conto master" icon={<Activity/>}/><Stat label="Settimana" value="—" delta="Aggiornamento live" icon={<ChartNoAxesCombined/>}/><Stat label="Screenshot" value="0" delta="Archivio risultati" icon={<FileText/>}/></div><div className="grid2"><Panel title="Andamento conto"><div className="chartPlaceholder"><ChartNoAxesCombined/><p>Il grafico apparirà dopo il collegamento del worker MT5 sulla VPS.</p></div></Panel><Panel title="Screenshot automatici"><div className="uploadBox"><FileText/><b>Carica il pacchetto worker MT5</b><p>ZIP, guide e script vengono analizzati e versionati.</p><button className="secondary small">Seleziona ZIP</button></div></Panel></div></>}
function Economics({leads}:{leads:Lead[]}){const dep=leads.reduce((s,l)=>s+Number(l.deposit_total||0),0);return <><div className="stats"><Stat label="Spesa advertising" value="€0" delta="Periodo selezionato" icon={<CreditCard/>}/><Stat label="Costo per lead" value="—" delta={`${leads.length} lead`} icon={<Users/>}/><Stat label="Costo per deposito" value="—" delta={eur.format(dep)} icon={<CircleDollarSign/>}/><Stat label="ROAS / rebate" value="—" delta="Collega costo ads" icon={<BarChart3/>}/></div><Panel title="Performance per canale e lingua"><div className="emptyState"><BarChart3/><h3>Attribuzione pronta</h3><p>Inserisci la spesa manualmente o collega la sorgente advertising per calcolare CPL, CPA, deposito medio e rebate per canale e lingua.</p><button className="primary small">Aggiungi costo ads</button></div></Panel></>}
function Prompt({demo}:{demo:boolean}){return <div className="editorLayout"><div className="editorNav"><button className="selected"><Sparkles/> Prompt commerciale <small>Bot XAU</small></button><button><Languages/> Traduzioni <small>12 lingue</small></button><button><ShieldCheck/> Regole e sicurezza <small>Trading</small></button></div><div className="editor"><div className="panelHead"><div><h2>Prompt AI conversazione</h2><p>Versione pubblicata · Italiano</p></div><Status value="active"/></div><textarea defaultValue={"Sei Leonardo, assistente commerciale XAU Machine. Rispondi con testo libero, in modo chiaro e responsabile. Guida il cliente dalla domanda iniziale alla registrazione, verifica IB e deposito..."} readOnly={demo}/><div className="uploadInline"><FileText/><span><b>Aggiungi file TXT</b><small>Italiano o inglese · versionamento automatico</small></span><button className="secondary small" disabled={demo}>Scegli file</button></div><div className="editorActions"><button className="secondary" disabled={demo}>Anteprima</button><button className="primary" disabled={demo}>Salva nuova versione</button></div></div></div>}
function Materials({demo}:{demo:boolean}){return <><div className="pageIntro"><div><h2>Libreria centrale</h2><p>Guide, screenshot, TXT, PDF e ZIP disponibili al chatbot e agli operatori.</p></div><button className="primary small" disabled={demo}>+ Carica materiale</button></div><div className="cardGrid"><Material name="Guida installazione bot" type="PDF" access="Solo dopo verifica IB"/><Material name="Prompt commerciale Leonardo" type="TXT" access="AI + operatori"/><Material name="Worker MT5 e screenshot" type="ZIP" access="Solo amministratori"/><Material name="Risultati giornalieri" type="IMMAGINI" access="Chatbot"/></div></>}
function Material({name,type,access}:{name:string;type:string;access:string}){return <div className="material"><FileText/><span className="lang">{type}</span><h3>{name}</h3><p>{access}</p><button className="secondary small">Apri</button></div>}
function Integrations(){const items=[["Telegram Bot","Attivo","@XauMachineAisupport_bot"],["OpenAI / ChatGPT","Da configurare","Conversazione AI"],["Claude","Errore chiave","Fallback AI"],["PU Prime","Worker VPS","3 IB"],["MetaTrader 5","Da collegare","Conto master"],["WhatsApp","Da configurare","QR e follow-up"],["Ringover","Da verificare","Chiamate operatore"],["Brevo Email","Da configurare","Email e notifiche"]];return <><div className="securityNote"><ShieldCheck/><div><b>Archivio credenziali protetto</b><p>I valori sensibili vengono salvati solo lato server e non sono mai restituiti al browser.</p></div></div><div className="cardGrid integrations">{items.map(([name,status,desc],i)=><div className="integration" key={name}><div className="integrationIcon">{i===0?<Bot/>:<Plug/>}</div><div><h3>{name}</h3><p>{desc}</p></div><Status value={status==="Attivo"?"active":status==="Errore chiave"?"error":"not_configured"}/><button className="secondary small">Configura</button></div>)}</div></>}
function Tenants({current}:{current:Tenant|null}){return <><div className="pageIntro"><div><h2>Clienti e ambienti</h2><p>Ogni azienda vede esclusivamente lead, conversazioni, bot, campagne e integrazioni proprie.</p></div><button className="primary small">+ Nuovo cliente</button></div><div className="tenantCards"><div className="tenantCard"><div className="brandMark">X</div><div><h3>{current?.name}</h3><p>{current?.slug} · Piano {current?.plan_code}</p></div><Status value={current?.status||"active"}/><div className="miniStats"><span><b>Owner</b> ruolo</span><span><b>8</b> moduli</span><span><b>Live</b> ambiente</span></div></div><div className="tenantCard"><div className="brandMark demoMark">D</div><div><h3>XAU Machine Demo</h3><p>demo · Accesso view-only</p></div><Status value="demo"/><div className="miniStats"><span><b>Demo</b> piano</span><span><b>1</b> utente</span><span><b>Finto</b> dataset</span></div></div></div></>}
function Billing({tenant}:{tenant:Tenant|null}){return <><div className="stats"><Stat label="Piano attuale" value={tenant?.plan_code.toUpperCase()||"FULL"} delta="Tutti i moduli" icon={<CreditCard/>}/><Stat label="Stato" value={tenant?.status||"active"} delta="Accesso operativo" icon={<ShieldCheck/>}/><Stat label="Licenze MT5" value="0" delta="Attive" icon={<FileText/>}/><Stat label="AI questo mese" value="€0" delta="Consumo tracciato" icon={<Sparkles/>}/></div><Panel title="Piani SaaS"><div className="planGrid">{[["CRM","Lead, campagne e operatori"],["CRM + AI","Chatbot e follow-up"],["Trading","MT5 e sala segnali"],["Full","PU Prime + tutto"],["White label","Brand personalizzato"]].map(([a,b])=><div key={a}><h3>{a}</h3><p>{b}</p><button className="secondary small">Configura prezzo</button></div>)}</div></Panel></>}
function SettingsPage({demo}:{demo:boolean}){return <div className="settingsGrid"><Panel title="Brand e profilo"><label>Nome azienda<input defaultValue="XAU Machine" readOnly={demo}/></label><label>Email amministratore<input type="email" defaultValue="infogaetano@yahoo.it" readOnly={demo}/></label><label>Lingua predefinita<select disabled={demo}><option>Italiano</option><option>English</option></select></label><button className="primary small" disabled={demo}>Salva</button></Panel><Panel title="Sicurezza e accessi"><div className="settingRow"><span><b>Isolamento tenant</b><small>Row Level Security</small></span><Status value="active"/></div><div className="settingRow"><span><b>Demo</b><small>Sola lettura</small></span><Status value="active"/></div><div className="settingRow"><span><b>Audit log</b><small>Azioni amministratori</small></span><Status value="active"/></div><button className="secondary small">Gestisci team</button></Panel></div>}
