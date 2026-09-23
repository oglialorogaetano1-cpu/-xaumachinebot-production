const defaultLeads=[
 {id:1,name:'Matteo Rossi',i:'MR',lang:'IT',campaign:'Italia Gold',product:'XAU Machine',stage:'Pronto al deposito',ib:'In attesa',last:'2 min fa',priority:'Alta',owner:'Gaetano',note:'Richiesta chiamata prima del deposito.'},
 {id:2,name:'Nikola Samardžić',i:'NS',lang:'SR',campaign:'Serbia Signals',product:'XAU Machine',stage:'Verifica IB',ib:'In verifica',last:'18 min fa',priority:'Media',owner:'AI',note:'Registrato, attende verifica IB.'},
 {id:3,name:'Carlos Medina',i:'CM',lang:'ES',campaign:'Spagna Agosto',product:'XAU Machine',stage:'Follow-up 24h',ib:'Non registrato',last:'Oggi 10:23',priority:'Media',owner:'AI',note:'Ha ricevuto report settimanale.'},
 {id:4,name:'Elena Popovic',i:'EP',lang:'SR',campaign:'Organico',product:'Sala segnali',stage:'Accesso attivo',ib:'Verificato',last:'Ieri',priority:'Bassa',owner:'Gaetano',note:'Guida e accesso inviati.'},
 {id:5,name:'Anna Bianchi',i:'AB',lang:'IT',campaign:'Italia Gold',product:'XAU Machine',stage:'Nuovo lead',ib:'Non registrato',last:'Ieri',priority:'Bassa',owner:'AI',note:'Prima risposta AI inviata.'}
];
const stages=['Nuovo lead','In conversazione','Registrazione','Verifica IB','Pronto al deposito','Accesso attivo','Non interessato'];
const get=(key,fallback)=>{try{return JSON.parse(localStorage.getItem(key))||fallback}catch{return fallback}};
const st={page:'overview',selected:null,filter:'Tutti',q:'',leads:get('xau-leads',defaultLeads),msgs:get('xau-msgs',{}),realConversations:[],realMessages:[],channelJoinEvents:[],campaignRecords:[],followups:get('xau-fu',[]),campaigns:get('xau-campaigns',[]),adcosts:get('xau-adcosts',[]),usage:[],uploads:[],channelSources:[],followRules:[],promptVersions:[],rules:get('xau-rules','Quando un lead entra: rispondi nella sua lingua, registra campagna e canale. Se non risponde, usa sequenze diverse per indeciso non iscritto, iscritto non depositato e depositato: 2 ore, 24 ore, 48 ore, settimanale e mensile. Se risulta registrato PU Prime, chiedi verifica IB. Se è verificato, invia guida. Se deposita, passa subito a operatore e invia onboarding. Se risponde, interrompi ogni follow-up precedente.'),prompt:get('xau-prompt','Sei l’assistente commerciale di XAU Machine. Rispondi in modo chiaro e trasparente. Non promettere rendimenti né risultati garantiti. Spiega il funzionamento, invia solo materiali reali e aggiornati e guida alla registrazione.'),puprime:[],puprimeRebate:[],ppQ:'',ppFilter:'Tutti',puprimeLastSync:null};
const SB_URL='https://vtssggkdfwuglmqsyxuo.supabase.co';
const SB_KEY='sb_publishable_8UuRQ5F3AVLf5RYGANWrcw_vkD3Q6Jo';
const db=window.supabase?.createClient(SB_URL,SB_KEY,{auth:{persistSession:true,autoRefreshToken:true,detectSessionInUrl:true}});
let dbReady=false;
const dbLead=x=>({id:x.id,name:x.full_name||x.username||'Lead senza nome',i:(x.full_name||x.username||'L').split(/\s+/).map(v=>v[0]).join('').slice(0,2).toUpperCase(),lang:(x.language||'IT').toUpperCase(),campaign:x.first_source||'Organico',product:x.product||'XAU Machine',stage:(x.status||'new').replaceAll('_',' '),ib:x.puprime_status||'Non registrato',last:x.updated_at?new Date(x.updated_at).toLocaleString('it-IT'):'—',priority:'Media',owner:'AI',note:x.notes||'Lead sincronizzato',deposit:Number(x.deposit_total||0)>0?'Sì':'No',raw:x});
async function loadRealData(){if(!db)return;let [{data:ls,error:le},{data:cv},{data:ms},{data:fu},{data:cs},{data:us},{data:up},{data:ch},{data:fr},{data:pv},{data:pc},{data:pr}]=await Promise.all([db.from('crm_leads').select('*').order('created_at',{ascending:false}).limit(500),db.from('crm_conversations').select('*').order('last_message_at',{ascending:false,nullsFirst:false}).limit(500),db.from('crm_messages').select('*').order('created_at',{ascending:true}).limit(5000),db.from('crm_followups').select('*,rule:crm_followup_rules(name,lead_status,delay_minutes)').is('sent_at',null).is('cancelled_at',null).order('scheduled_for',{ascending:true}).limit(500),db.from('crm_ad_spend').select('*').limit(500),db.from('crm_usage_monthly').select('*').order('month',{ascending:false}).limit(24),db.from('crm_uploads').select('*').order('created_at',{ascending:false}),db.from('crm_channel_sources').select('*').order('created_at',{ascending:false}),db.from('crm_followup_rules').select('*').order('created_at',{ascending:false}),db.from('crm_prompt_versions').select('*').order('created_at',{ascending:false}),db.from('puprime_clienti').select('*').order('aggiornato',{ascending:false}).limit(1000),db.from('puprime_rebate').select('*').order('data',{ascending:false}).limit(60)]);if(le){toast('Supabase: '+le.message);return}st.leads=(ls||[]).map(dbLead);st.realConversations=cv||[];st.realMessages=ms||[];if(!st.selected||!st.leads.some(x=>String(x.id)===String(st.selected)))st.selected=st.leads[0]?.id||null;st.followups=(fu||[]).map(x=>{const rule=Array.isArray(x.rule)?x.rule[0]:x.rule;return {id:x.id,lead:x.lead_id,when:x.scheduled_for?new Date(x.scheduled_for).toLocaleString('it-IT'):'—',scheduledAt:x.scheduled_for,type:x.sequence_key||rule?.name||x.channel||'Follow-up',segment:rule?.lead_status||'',delayMinutes:Number(rule?.delay_minutes||0),attempts:Number(x.attempts||0),lastError:x.last_error||''}});st.adcosts=(cs||[]).map(x=>({id:x.id,campaign:x.external_reference||'Campagna',channel:x.channel,lang:x.language,cost:Number(x.amount),start:x.period_start,end:x.period_end,period:[x.period_start,x.period_end].filter(Boolean).join(' – ')}));st.usage=us||[];st.uploads=up||[];st.channelSources=ch||[];st.followRules=fr||[];st.promptVersions=pv||[];if(pv?.[0])st.prompt=pv.find(x=>x.active)?.content||pv[0].content;st.puprime=pc||[];st.puprimeRebate=pr||[];st.puprimeLastSync=(pc||[]).reduce((m,x)=>{const t=x.aggiornato?Date.parse(x.aggiornato):0;return t>m?t:m},0)||null;dbReady=true;subscribeCRMRealtime();render(st.page);}
async function bootAuth(){if(!db){document.querySelector('#auth-message').textContent='Libreria Supabase non disponibile.';return}let {data:{session}}=await db.auth.getSession();if(session){document.querySelector('#auth-gate').classList.add('ready');await loadRealData()}document.querySelector('#auth-form').onsubmit=async e=>{e.preventDefault();let email=document.querySelector('#auth-email').value,password=document.querySelector('#auth-password').value,m=document.querySelector('#auth-message');m.textContent='Accesso…';let {error}=await db.auth.signInWithPassword({email,password});m.textContent=error?error.message:'Accesso riuscito';if(!error){document.querySelector('#auth-gate').classList.add('ready');await loadRealData()}};document.querySelector('#signup').onclick=async()=>{let email=document.querySelector('#auth-email').value,password=document.querySelector('#auth-password').value,m=document.querySelector('#auth-message');if(email.toLowerCase()!=='infogaetano@yahoo.it'){m.textContent='Email non autorizzata.';return}let {error}=await db.auth.signUp({email,password,options:{emailRedirectTo:'https://xau-machine-crm.vercel.app'}});m.textContent=error?error.message:'Accesso creato. Conferma l’email e torna al CRM.'};document.querySelector('#logout').onclick=async()=>{await db.auth.signOut();location.reload()}};
const save=()=>{localStorage.setItem('xau-leads',JSON.stringify(st.leads));localStorage.setItem('xau-msgs',JSON.stringify(st.msgs));localStorage.setItem('xau-fu',JSON.stringify(st.followups));localStorage.setItem('xau-campaigns',JSON.stringify(st.campaigns));localStorage.setItem('xau-adcosts',JSON.stringify(st.adcosts));localStorage.setItem('xau-rules',JSON.stringify(st.rules));localStorage.setItem('xau-prompt',JSON.stringify(st.prompt))};
const esc=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#039;'}[c]));
const lead=id=>st.leads.find(x=>String(x.id)===String(id))||st.leads[0];
const btn=(text,act,style='secondary')=>'<button class="'+style+'" data-action="'+act+'">'+text+'</button>';
const status=value=>'<span class="status '+(/Accesso|Verificato/.test(value)?'ok':/deposito|Alta/.test(value)?'hot':/attesa|verifica|Follow/.test(value)?'wait':'')+'">'+esc(value)+'</span>';
const metric=(a,b,c,k='')=>'<div class="card metric-card"><label>'+a+'</label><div class="metric">'+b+'</div><span class="delta '+k+'">'+c+'</span></div>';
function rows(list=st.leads){
 return '<div class="table-wrap"><table><thead><tr><th>LEAD</th><th>PROVENIENZA</th><th>STATO</th><th>PU PRIME</th><th>ULTIMA ATTIVITÀ</th><th></th></tr></thead><tbody>'+(!list.length?'<tr><td colspan="6" class="empty">Nessun lead trovato</td></tr>':list.map(l=>'<tr><td><div class="person"><span class="avatar">'+l.i+'</span><div><b>'+esc(l.name)+'</b><small>'+esc(l.product)+' · '+l.lang+'</small></div></div></td><td><b>'+esc(l.campaign)+'</b><small>Telegram · link tracciato</small></td><td>'+status(l.stage)+'</td><td>'+status(l.ib)+'</td><td><small>'+l.last+'</small></td><td><button class="row-more" data-open="'+l.id+'">Apri</button></td></tr>').join(''))+'</tbody></table></div>';
}
const connection=(a,b,k)=>'<div class="connector"><i class="dot '+k+'"></i><div><b>'+a+'</b><small>'+b+'</small></div></div>';
function overview(){
 const active=st.leads.filter(x=>x.stage!=='Non interessato').length,verify=st.leads.filter(x=>x.stage==='Verifica IB').length,hot=st.leads.filter(x=>/deposito/.test(x.stage)).length;
 return '<div class="hero"><div><p class="eyebrow">XAU MACHINE · CONTROLLO COMMERCIALE</p><h2>Ogni lead, chat e conversione in un unico posto.</h2><p>Gestisci le priorità, passa all’operatore e tieni traccia di ogni iscrizione senza perdere la cronologia.</p></div><div class="hero-actions">'+btn('Apri conversazioni','go:inbox','primary')+btn('Nuovo lead','newlead')+'</div></div>'+
 '<div class="grid4">'+metric('Lead attivi',active,'pipeline aggiornata')+metric('In verifica IB',verify,'controllo previsto ogni 30 min')+metric('Pronti al deposito',hot,'priorità commerciale','hot')+metric('Interventi umani',st.leads.filter(x=>x.priority==='Alta').length,'da prendere in carico','down')+'</div>'+
 '<section class="section"><div class="section-head"><div><p class="eyebrow">FUNNEL</p><h2>Pipeline commerciale</h2></div>'+btn('Gestisci lead','go:leads')+'</div><div class="pipeline">'+stages.slice(0,6).map(s=>{let n=st.leads.filter(x=>x.stage===s).length;return '<button class="stage" data-filter="'+s+'"><span>'+s+'</span><b>'+n+'</b><i style="width:'+Math.min(100,n*28+6)+'%"></i></button>'}).join('')+'</div></section>'+
 '<section class="section two"><div class="card table-card"><div class="table-title"><div><b>Da seguire adesso</b><span>ordinati per priorità</span></div>'+btn('Vedi tutti','go:leads')+'</div>'+rows(st.leads.filter(x=>x.priority!=='Bassa').slice(0,4))+'</div><div class="card status-card"><div class="table-title"><div><b>Collegamenti</b><span>stato operativo</span></div></div><div class="connector-list">'+connection('Telegram bot','Webhook verificato','ok')+connection('PU Prime','Worker VPS in preparazione','wait')+connection('MT5 risultati','Materiali da collegare','wait')+connection('Coda follow-up',st.followups.length+' azioni programmate','ok')+'</div>'+btn('Impostazioni','go:settings')+'</div></section>';
}
function leads(){
 const found=st.leads.filter(l=>(st.filter==='Tutti'||l.stage===st.filter)&&(l.name+' '+l.campaign+' '+l.lang).toLowerCase().includes(st.q.toLowerCase()));
 return '<div class="toolbar mobile-stack"><input id="search" class="search" placeholder="Cerca nome, campagna o lingua" value="'+esc(st.q)+'"><select id="filter" class="filter"><option>Tutti</option>'+stages.map(x=>'<option '+(st.filter===x?'selected':'')+'>'+x+'</option>').join('')+'</select>'+btn('+ Nuovo lead','newlead','primary')+'</div><div class="card table-card">'+rows(found)+'</div>';
}
function cleanBody(body){let s=String(body||'');try{let j=JSON.parse(s);if(j.reply_text)s=j.reply_text;else if(j.text)s=j.text}catch{}return s}
function messageHtml(x){let body=esc(cleanBody(x.body||x.text));body=body.replace(/(https?:\/\/[^\s<]+)/g,'<a href="$1" target="_blank" rel="noreferrer">$1</a>');if(/\.(png|jpe?g|gif|webp)(\?[^\s<]*)?$/i.test(cleanBody(x.body||x.text)))body+='<img class="message-image" src="'+esc(cleanBody(x.body||x.text))+'" alt="Allegato della conversazione">';let who=x.sender_type==='lead'?'client':x.sender_type==='human'?'human':x.sender_type==='system'?'system':'ai';return '<div class="msg '+who+'"><div>'+body+'</div><small>'+esc(x.sender_type||'messaggio')+' · '+new Date(x.created_at||Date.now()).toLocaleString('it-IT')+'</small></div>'}
function inbox(){
 const l=lead(st.selected),cv=st.realConversations.find(x=>String(x.lead_id)===String(l?.id)),real=cv?st.realMessages.filter(x=>String(x.conversation_id)===String(cv.id)):[],m=real.length?real:(st.msgs[l?.id]||[]);if(!l)return '<div class="empty">Nessuna conversazione disponibile.</div>';
 const aiOn=cv?.ai_enabled!==false;
 return '<div class="chat-shell"><aside class="chat-list"><div class="chat-list-title"><b>Conversazioni reali</b><span>'+st.realConversations.length+'</span></div>'+st.leads.map(x=>'<button class="chat-item '+(String(x.id)===String(l.id)?'active':'')+'" data-chat="'+x.id+'"><span class="avatar">'+x.i+'</span><div><b>'+esc(x.name)+'</b><small>'+esc(x.stage)+' · '+x.last+'</small></div>' +(x.priority==='Alta'?'<i></i>':'')+'</button>').join('')+'</aside><section class="messages"><div class="chat-head"><div class="mobile-chat-back">'+btn('← Lista conversazioni','mobile:list','secondary')+'<b>'+esc(l.name)+'</b><small>'+esc(l.campaign)+' · '+l.lang+' · '+esc(l.product)+'</small></div><div class="desktop-chat-title"><b>'+esc(l.name)+'</b><small>'+esc(l.campaign)+' · '+l.lang+' · '+esc(l.product)+'</small></div><div class="chat-head-actions">'+status(l.stage)+ (cv?btn(aiOn?'Stop bot':'Riattiva bot','bot:'+cv.id,'secondary'):'')+'</div></div><div class="ai-note"><span>✦</span><div><b>'+(aiOn?'AI attiva':'Bot fermato · modalità operatore')+'</b><small>La cronologia viene letta direttamente da Supabase e si aggiorna in tempo reale.</small></div>'+btn('Prendi in carico','take:'+l.id,'primary')+'</div><div class="message-list">'+(m.length?m.map(x=>x.body?messageHtml(x):'<div class="msg '+esc(x.who)+'"><div>'+esc(x.text)+'</div><small>'+esc(x.who)+' · '+esc(x.time)+'</small></div>').join(''):'<div class="empty">Nessun messaggio in questa conversazione.</div>')+'</div><form id="send-form" class="compose"><input id="message" placeholder="Scrivi come operatore…" autocomplete="off" required>'+btn('Invia','send','primary')+'<label class="attach-button" title="Allega screenshot"><input id="attachment" type="file" accept="image/*">📎</label></form></section><aside class="lead-drawer"><div class="drawer-top"><span class="avatar big">'+l.i+'</span><div><h3>'+esc(l.name)+'</h3><small>Telegram · '+esc(l.campaign)+'</small></div></div><dl><dt>Stato</dt><dd>'+status(l.stage)+'</dd><dt>PU Prime</dt><dd>'+status(l.ib)+'</dd><dt>Prossima azione</dt><dd>'+esc(l.note)+'</dd><dt>Assegnato a</dt><dd>'+esc(l.owner)+'</dd></dl>'+btn('Crea follow-up','follow:'+l.id)+btn('Intervento umano','human:'+l.id,'primary')+'</aside></div>';
}
function followupSegmentLabel(value){
 return ({undecided_unregistered:'Indeciso · non iscritto',registered_not_deposited:'Iscritto · non depositato',deposited:'Depositato'})[value]||value||'Contesto da verificare';
}
function followupDelayLabel(minutes){
 const n=Number(minutes||0);
 if(n===120)return 'Dopo 2 ore';
 if(n===1440)return 'Dopo 24 ore';
 if(n===2880)return 'Dopo 48 ore';
 if(n===10080)return 'Settimanale';
 if(n===43200)return 'Mensile';
 if(n%10080===0)return 'Ogni '+(n/10080)+' settimane';
 if(n%1440===0)return 'Dopo '+(n/1440)+' giorni';
 return 'Dopo '+Math.max(1,Math.round(n/60))+' ore';
}
function followups(){
 const items=[...st.followups].sort((a,b)=>Date.parse(a.scheduledAt||0)-Date.parse(b.scheduledAt||0));
 const count=n=>items.filter(x=>x.delayMinutes===n).length;
 return '<div class="notice"><span>↻</span><div><b>Follow-up automatici contestuali attivi.</b><br>Il messaggio cambia per cliente indeciso, iscritto non depositato o depositato. La sequenza si ferma su risposta, rinuncia o disattivazione del bot.</div></div>'+
 '<div class="grid4 section">'+metric('Dopo 2 ore',count(120),'primo richiamo')+metric('Dopo 24 ore',count(1440),'secondo contatto')+metric('Dopo 48 ore',count(2880),'sblocco dubbi')+metric('Settimanale',count(10080),'controllo utile')+metric('Mensile',count(43200),'riapertura discreta')+'</div>'+
 '<div class="section"><div class="section-head"><div><p class="eyebrow">CONTESTI ATTIVI</p><h2>Segmentazione intelligente</h2></div>'+btn('+ Programma follow-up','newfollow','primary')+'</div>'+
 '<div class="grid4">'+metric('Indecisi',items.filter(x=>x.segment==="undecided_unregistered").length,'non iscritti')+metric('Iscritti',items.filter(x=>x.segment==="registered_not_deposited").length,'non depositati')+metric('Depositati',items.filter(x=>x.segment==="deposited").length,'supporto post-attivazione')+metric('Coda automatica',items.length,'azioni pianificate')+'</div></div>'+
 '<div class="section"><div class="section-head"><div><p class="eyebrow">CODA AUTOMATICA</p><h2>Prossime azioni</h2></div>'+btn('+ Nuova regola intelligente','newrule','primary')+'</div><div class="page-list">'+
 (items.length?items.map(x=>{let l=lead(x.lead);return '<div class="row"><div class="person"><span class="avatar">'+l.i+'</span><div><b>'+esc(l.name)+'</b><small>'+esc(followupSegmentLabel(x.segment))+' · '+esc(l.campaign)+'</small></div></div><div>'+status(followupDelayLabel(x.delayMinutes))+'</div><div><b>'+esc(x.when)+'</b><small>Telegram'+(x.attempts?' · tentativo '+x.attempts:'')+'</small></div>'+btn('Apri chat','chat:'+l.id)+btn('Annulla','cancel:'+x.id)+'</div>'}).join(''):'<div class="empty">Nessun follow-up in coda. Le nuove conversazioni verranno pianificate automaticamente.</div>')+
 '</div></div>';
}
function automation(){
 const rules=[...(st.followRules||[])].sort((a,b)=>Number(a.delay_minutes)-Number(b.delay_minutes)||String(a.name).localeCompare(String(b.name)));
 return '<div class="notice"><span>⚡</span><div><b>Regole intelligenti per contesto.</b><br>Puoi aggiungere altri messaggi scegliendo il tipo di cliente e la scadenza. Ogni regola usa {nome} per personalizzare il testo.</div></div>'+
 '<div class="toolbar section">'+btn('+ Nuova regola','newrule','primary')+'</div><div class="page-list">'+
 (rules.length?rules.map(x=>'<div class="row"><div><b>'+esc(x.name)+'</b><small>'+esc(followupSegmentLabel(x.lead_status))+'</small></div><div>'+status(x.enabled?'Attiva':'Pausa')+'</div><div><b>'+esc(followupDelayLabel(x.delay_minutes))+'</b><small>'+esc(x.channel)+'</small></div><div><small>'+esc(x.message_template).slice(0,120)+'</small></div></div>').join(''):'<div class="empty">Nessuna regola attiva.</div>')+
 '</div><div class="section card"><p class="eyebrow">ISTRUZIONE GENERALE</p><h2>Logica commerciale</h2><textarea id="rules" class="promptbox">'+esc(st.rules)+'</textarea><div class="toolbar">'+btn('Salva istruzione','saverules','primary')+'</div></div>';
}
function analytics(){let all=[...new Set([...st.leads.map(l=>l.campaign),...st.adcosts.map(x=>x.campaign)])],total=st.adcosts.reduce((s,x)=>s+Number(x.cost||0),0),verified=st.leads.filter(l=>l.ib==='Verificato').length,deposits=st.leads.filter(l=>/deposito/i.test(l.stage)||l.deposit==='Sì').length;let n=x=>x?('€ '+(total/x).toFixed(2)):'—';return '<div class="notice"><span>◔</span><div><b>Controllo CPA e conversioni.</b><br>Inserisci costi ads manualmente oppure collega Meta/Google: il CRM attribuisce spesa, lead, IB verificati e depositi per campagna, canale e lingua.</div></div><div class="grid4 section">'+metric('Spesa ads',total?'€ '+total.toFixed(2):'—',total?'periodo selezionato':'inserisci il primo costo')+metric('Costo per lead',n(st.leads.length),st.leads.length+' lead tracciati')+metric('Costo per IB',n(verified),verified+' verificati')+metric('Costo per deposito',n(deposits),deposits+' depositi attribuiti')+'</div><div class="section card table-card"><div class="table-title"><div><b>Rendimento per campagna</b><span>spesa e conversioni attribuite</span></div>'+btn('+ Inserisci costo ads','newadcost','primary')+'</div><div class="table-wrap"><table class="analytics-table"><thead><tr><th>CAMPAGNA</th><th>LEAD</th><th>IB</th><th>DEPOSITI</th><th>SPESA</th><th>CPA LEAD</th><th>CPA DEPOSITO</th></tr></thead><tbody>'+all.map(c=>{let ls=st.leads.filter(l=>l.campaign===c),cost=st.adcosts.filter(x=>x.campaign===c).reduce((s,x)=>s+Number(x.cost),0),ib=ls.filter(l=>l.ib==='Verificato').length,dep=ls.filter(l=>/deposito/i.test(l.stage)||l.deposit==='Sì').length;return '<tr><td><b>'+esc(c)+'</b><small>'+esc(ls[0]?.lang||'—')+' · Telegram</small></td><td>'+ls.length+'</td><td>'+ib+'</td><td>'+dep+'</td><td>'+ (cost?'€ '+cost.toFixed(2):'—')+'</td><td>'+ (cost&&ls.length?'€ '+(cost/ls.length).toFixed(2):'—')+'</td><td>'+ (cost&&dep?'€ '+(cost/dep).toFixed(2):'—')+'</td></tr>'}).join('')+'</tbody></table></div></div><div class="section two"><div class="card"><p class="eyebrow">ATTRIBUZIONE</p><h2>Cosa salva ogni lead</h2><p class="muted-copy">Primo canale, campagna, lingua, link deep-link, data, costo attribuito, stato PU Prime, deposito, rebate e valore cliente.</p></div><div class="card"><p class="eyebrow">SORGENTI ADS</p><h2>Pronte da collegare</h2><p class="muted-copy">Meta Ads, Google Ads, TikTok, campagne Telegram e import CSV. Fino al collegamento puoi inserire i costi qui, senza perdere lo storico.</p></div></div>'}
function channels(){return '<div class="notice"><span>▤</span><div><b>Attribuzione automatica.</b><br>Inserisci link, lingua e codice campagna; il bot userà un deep link univoco.</div></div><div class="toolbar section">'+btn('+ Aggiungi canale Telegram','newchannel','primary')+'</div><div class="page-list">'+(st.channelSources.length?st.channelSources.map(x=>'<div class="row"><div><b>'+esc(x.name)+'</b><small>'+esc(x.telegram_url)+'</small></div><div>'+status(x.language.toUpperCase())+'</div><div><code>?start='+esc(x.campaign_code)+'</code></div><div><small>'+esc(x.product)+'</small></div></div>').join(''):'<div class="empty">Nessun canale ancora inserito.</div>')+'</div>'}
function resources(){return '<div class="notice"><span>⇧</span><div><b>Centro caricamenti privato.</b><br>Carica qui ZIP MT5/sala segnali, prompt, guide, PDF, immagini e materiali. Dimensione massima 500 MB.</div></div><form id="upload-form" class="card upload-panel section"><div class="form-two"><div><label>Tipo contenuto</label><select name="kind"><option value="mt5_project">Progetto MT5 ZIP</option><option value="signal_room">Sala segnali</option><option value="prompt">Prompt</option><option value="guide">Guida</option><option value="material">Materiale commerciale</option><option value="other">Altro</option></select></div><div><label>File</label><input name="file" type="file" required></div></div><div class="upload-progress"><i id="upload-bar"></i></div><small id="upload-status">I file restano privati e accessibili solo all’amministratore.</small><button class="primary" type="submit">Carica nel CRM</button></form><div class="section page-list">'+(st.uploads.length?st.uploads.map(x=>'<div class="row"><div><b>'+esc(x.name)+'</b><small>'+esc(x.kind)+' · '+new Date(x.created_at).toLocaleString('it-IT')+'</small></div><div>'+status(x.processing_status)+'</div><div><b>'+((x.size_bytes||0)/1048576).toFixed(1)+' MB</b></div><div><small>'+esc(x.processing_notes||'Pronto per analisi')+'</small></div></div>').join(''):'<div class="empty">Nessun file caricato.</div>')+'</div>'}
function team(){return '<div class="section page-list">'+[['Gaetano','Amministratore','Tutti i dati, prompt e integrazioni'],['AI commerciale','Automazione','Risposte, qualificazione e follow-up'],['Operatore vendite','Commerciale','Prende in carico, chiama e chiude'],['Supporto','Assistenza','Post-accesso e richieste clienti']].map(x=>'<div class="row"><div><b>'+x[0]+'</b><small>'+x[1]+'</small></div><div>'+status('Attivo')+'</div><div><small>'+x[2]+'</small></div>'+btn('Permessi','toast:Ruoli reali saranno gestiti con autenticazione.')+'</div>').join('')+'</div>'}
function human(){
 const list=st.leads.filter(x=>x.priority==='Alta'||x.owner==='Operatore');
 return '<div class="notice"><span>♙</span><div><b>Coda intervento umano.</b><br>Chi prende il lead vede chat, priorità, motivo e azione suggerita.</div></div><div class="section page-list">'+(list.length?list.map(l=>'<div class="row"><div class="person"><span class="avatar">'+l.i+'</span><div><b>'+esc(l.name)+'</b><small>'+esc(l.note)+'</small></div></div><div>'+status(l.priority)+'</div><div><b>'+esc(l.owner)+'</b><small>assegnatario</small></div>'+btn('Apri chat','chat:'+l.id)+btn(l.owner==='Gaetano'?'In gestione':'Prendi in carico','take:'+l.id,'primary')+'</div>').join(''):'<div class="empty">Nessun intervento umano in coda.</div>')+'</div>';
}
function ppMoney(v){return '$'+Number(v||0).toLocaleString('it-IT',{maximumFractionDigits:2});}
function ppDate(v){if(!v)return '—';try{return new Date(v).toLocaleString('it-IT');}catch(e){return String(v);}}
function ppStatoIB(v){if(v==='2')return 'Verificato';if(v==='3')return 'Rifiutato';return 'Da verificare';}
function ppMatch(x,q){const hay=[x.nome,x.email,x.id_utente,x.numero_conto].map(v=>String(v||'').toLowerCase()).join(' ');return hay.includes(q);}
function ppPassesFilter(x,f){
  if(f==='Attivi')return x.attivo===true;
  if(f==='Non attivi')return x.attivo!==true;
  if(f==='IB confermato')return x.stato_id==='2';
  if(f==='IB da verificare')return x.stato_id!=='2';
  if(f==='Depositati')return Number(x.ultimo_deposito_importo||0)>0;
  if(f==='Non depositati')return !(Number(x.ultimo_deposito_importo||0)>0);
  return true;
}
function ppRows(list){
  const head='<tr><th>CLIENTE</th><th>CONTATTI</th><th>ID UTENTE</th><th>N. CONTO</th><th>STATO IB</th><th>STATO CLIENTE</th><th>ATTIVO</th><th>SALDO</th><th>PRIMO DEPOSITO</th><th>ULTIMO DEPOSITO</th><th>IMPORTO ULT. DEPOSITO</th><th>REBATE</th><th>CANALE</th><th>AGGIORNATO</th></tr>';
  const body=!list.length?'<tr><td colspan="14" class="empty">Nessun cliente PU Prime trovato</td></tr>':list.map(x=>{
    const iniz=(x.nome||'?').trim().split(/\s+/).map(v=>v[0]||'').join('').slice(0,2).toUpperCase()||'?';
    const dep=Number(x.ultimo_deposito_importo||0)>0?(ppMoney(x.ultimo_deposito_importo)+' '+esc(x.ultimo_deposito_valuta||'')):'—';
    return '<tr><td><div class="person"><span class="avatar">'+esc(iniz)+'</span><b>'+esc(x.nome||'—')+'</b></div></td>'
      +'<td><small>'+esc(x.email||'—')+'</small><br><small>'+esc(x.telefono||'—')+'</small></td>'
      +'<td>'+esc(x.id_utente||'—')+'</td>'
      +'<td><b>'+esc(x.numero_conto||'—')+'</b></td>'
      +'<td>'+status(ppStatoIB(x.stato_id))+'</td>'
      +'<td>'+esc(x.stato||'—')+'</td>'
      +'<td>'+status(x.attivo?'Attivo':'Non attivo')+'</td>'
      +'<td>'+ppMoney(x.saldo)+'</td>'
      +'<td>'+esc(x.primo_deposito_data||'—')+'</td>'
      +'<td>'+esc(x.ultimo_deposito_data||'—')+'</td>'
      +'<td>'+dep+'</td>'
      +'<td>'+ppMoney(x.rebate)+'</td>'
      +'<td>'+esc(x.canale||'—')+'</td>'
      +'<td><small>'+ppDate(x.aggiornato)+'</small></td></tr>';
  }).join('');
  return '<div class="table-wrap"><table><thead>'+head+'</thead><tbody>'+body+'</tbody></table></div>';
}
function puprime(){
  const all=st.puprime||[];
  const q=st.ppQ.toLowerCase();
  const found=all.filter(x=>(!q||ppMatch(x,q))&&ppPassesFilter(x,st.ppFilter));
  const confermati=all.filter(x=>x.stato_id==='2').length;
  const ppFilters=['Tutti','Attivi','Non attivi','IB confermato','IB da verificare','Depositati','Non depositati'];
  return '<div class="grid4 section">'
    +metric('Clienti PU Prime',String(all.length),'sincronizzati dal worker VPS')
    +metric('Risultati filtrati',String(found.length),'ricerca/filtro attivi')
    +metric('IB confermati',String(confermati),'su '+all.length+' totali')
    +metric('Ultima sincronizzazione',st.puprimeLastSync?ppDate(st.puprimeLastSync):'—','Drive controllato ogni 2 ore')
    +'</div>'
    +'<div class="notice pp-import-note"><span>⇧</span><div><b>Sincronizzazione PU Prime da Google Drive ogni 2 ore.</b><br>Il CRM importa automaticamente l’ultimo file ib_accounts_*.xlsx. Puoi usare anche il caricamento manuale come riserva; i clienti vengono abbinati tramite numero conto.</div></div>'
    +'<div class="toolbar mobile-stack"><input id="pp-search" class="search" placeholder="Cerca nome, email, ID utente o numero conto" value="'+esc(st.ppQ)+'"><select id="pp-filter" class="filter">'+ppFilters.map(x=>'<option '+(st.ppFilter===x?'selected':'')+'>'+x+'</option>').join('')+'</select>'+btn('⇧ Importa export','pp-import','secondary')+btn('↻ Aggiorna ora','refresh','primary')+'<input id="pp-import-file" class="visually-hidden" type="file" accept=".csv,.tsv,.xls,.xlsx,text/csv,application/vnd.ms-excel,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"></div>'
    +'<div class="card table-card">'+ppRows(found)+'</div>';
}
function mt5(){return '<div class="notice"><span>▥</span><div><b>Conto MT5 verificabile.</b><br>La VPS legge il conto in sola lettura e invia al CRM equity, balance, P/L, storico e screenshot con data. Il cliente riceve esclusivamente materiali approvati.</div></div><div class="grid4 section">'+metric('Equity attuale','—','connessione MT5 da attivare')+metric('Risultato giornaliero','—','ultimo snapshot')+metric('Risultato settimanale','—','report verificato')+metric('Risultato mensile','—','report verificato')+'</div><div class="section two"><div class="card"><p class="eyebrow">CONNESSIONE CONTO</p><h2>MT5 → VPS → CRM</h2><div class="connection-steps"><div><b>1</b><span>Terminale MT5 nella VPS</span></div><div><b>2</b><span>Worker legge dati in sola lettura</span></div><div><b>3</b><span>Supabase conserva metriche e immagini</span></div><div><b>4</b><span>CRM e bot mostrano solo dati autorizzati</span></div></div><div class="toolbar">'+btn('Configura MT5','integration:mt5','primary')+btn('Stato connessione','toast:In attesa della VPS MT5.')+'</div></div><div class="card"><p class="eyebrow">INVIO SCREENSHOT</p><h2>Regole automatiche</h2><div class="schedule-list"><div><b>3 snapshot al giorno</b><small>Mattina, pomeriggio e chiusura; ora configurabile.</small></div><div><b>Su domanda cliente</b><small>L’AI invia l’ultimo screenshot approvato, non uno generato.</small></div><div><b>Report settimanale e mensile</b><small>Con periodo, origine e nota sui rischi.</small></div><div><b>Evento importante</b><small>Notifica operatori, mai promesse di rendimento.</small></div></div></div></div><div class="section two"><div class="card"><p class="eyebrow">MATERIALI COMMERCIALI</p><h2>Report pronti da inviare</h2><p class="muted-copy">Ogni invio è registrato sulla scheda del lead: quale file, quando, lingua e chi lo ha inviato.</p><div class="file-actions">'+btn('▧ Report giornaliero','toast:Disponibile dopo la prima lettura MT5.')+btn('▧ Report settimanale','toast:Disponibile dopo la prima lettura MT5.')+btn('▧ Report mensile','toast:Disponibile dopo la prima lettura MT5.')+'</div></div><div class="card"><p class="eyebrow">TRASPARENZA</p><h2>Regole non modificabili</h2><ul class="check-list"><li>Performance passate non garantiscono risultati futuri.</li><li>Nessuna promessa di rendimento né screenshot alterati.</li><li>Ogni screenshot mostra data, conto/origine e periodo.</li><li>Dubbi su rischio, deposito o prelievo passano a un operatore.</li></ul></div></div>'}
function campaigns(){let base=[{name:'Italia Gold',lang:'IT',ch:'?start=italia_gold',n:48,ib:9},{name:'Serbia Signals',lang:'SR',ch:'?start=serbia_signals',n:37,ib:7},{name:'Spagna Agosto',lang:'ES',ch:'?start=spagna_august',n:26,ib:4},{name:'Organico',lang:'Multi',ch:'Direct',n:17,ib:2}],all=[...base,...st.campaigns];return '<div class="toolbar">'+btn('+ Nuova campagna','newcampaign','primary')+'<button class="filter">Periodo: ultimo mese</button></div><div class="card table-card"><div class="table-wrap"><table><thead><tr><th>CAMPAGNA</th><th>LINGUA</th><th>CANALE / LINK</th><th>LEAD</th><th>IB VERIFICATI</th><th>STATO</th></tr></thead><tbody>'+all.map(x=>'<tr><td><b>'+esc(x.name)+'</b></td><td>'+x.lang+'</td><td><code>'+esc(x.ch)+'</code></td><td>'+x.n+'</td><td>'+x.ib+'</td><td>'+status('Attiva')+'</td></tr>').join('')+'</tbody></table></div></div><div class="notice section"><span>⌁</span><div><b>Attribuzione automatica.</b><br>Ogni canale usa un link Telegram con parametro <code>start</code> univoco: CRM salva campagna, lingua e provenienza al primo contatto.</div></div>'}
function prompts(){return '<div class="two prompt-grid"><form id="prompt-form" class="card"><div class="section-head"><div><p class="eyebrow">PROMPT AI · CONVERSAZIONE</p><h2>Prompt commerciale</h2></div>'+status('Versionato')+'</div><div class="prompt-import"><div><b>Importa il prompt da file TXT</b><small>Il testo viene letto nel CRM: puoi controllarlo e modificarlo prima di salvarlo.</small></div><div class="prompt-import-actions"><label class="file-button">TXT Italiano<input id="prompt-txt-it" type="file" accept=".txt,text/plain" data-prompt-lang="it"></label><label class="file-button">TXT English<input id="prompt-txt-en" type="file" accept=".txt,text/plain" data-prompt-lang="en"></label></div><small id="prompt-file-status">Puoi conservare una versione attiva per ogni lingua.</small></div><label>Tipo prompt</label><select name="product"><option value="conversation">Conversazione commerciale</option><option value="xau_machine">Bot operativo XAU Machine</option></select><label>Nome versione</label><input name="name" value="Prompt conversazione commerciale"><label>Lingua</label><select name="language"><option value="multi">Multilingua</option><option value="it">Italiano</option><option value="en">Inglese</option><option value="es">Spagnolo</option><option value="sr">Serbo</option></select><textarea name="content" id="prompt" class="promptbox">'+esc(st.prompt)+'</textarea><button class="primary" type="submit">Salva e attiva versione</button></form><div class="card"><p class="eyebrow">CRONOLOGIA</p><h2>Versioni salvate</h2><div class="page-list">'+(st.promptVersions.length?st.promptVersions.map(x=>'<div class="setting-row"><div><b>'+esc(x.name)+'</b><small>'+esc(x.product||'xau_machine')+' · '+x.language.toUpperCase()+' · v'+x.version+'</small></div>'+status(x.active?'Attiva':'Archivio')+'</div>').join(''):'<div class="empty">Nessuna versione salvata.</div>')+'</div></div></div>'}
function settings(){return '<div class="notice"><span>⚙</span><div><b>Centro integrazioni.</b><br>I campi sensibili vengono registrati solo dal backend protetto: il CRM non mostra mai token, password o chiavi già salvate.</div></div><div class="section integration-grid">'+
integrationCard('Telegram Bot','Risposte AI, webhook, deep link e follow-up','BOT_TOKEN · WEBHOOK_SECRET','Operativo','telegram')+
integrationCard('WhatsApp Business','Escalation operatore, QR e messaggi approvati','PHONE_NUMBER_ID · ACCESS_TOKEN','Da collegare','whatsapp')+
integrationCard('Ringover','Click-to-call, assegnazione e storico chiamate','RINGOVER_API_KEY · RINGOVER_SECRET','Da collegare','ringover')+
integrationCard('PU Prime','Clienti, IB, depositi e rebate dal worker VPS','PU_EMAIL · PU_PASSWORD','Da collegare','puprime')+
integrationCard('MT5','Screenshot, equity e report verificabili','MT5_LOGIN · MT5_SERVER','Da collegare','mt5')+
integrationCard('Brevo Email','Notifiche team, follow-up e messaggi clienti','BREVO_API_KEY · SENDER','Da collegare','email')+
integrationCard('Supabase','Lead, chat, follow-up e dati PU Prime','SUPABASE_URL · SERVER_SECRET','Da identificare','supabase')+
integrationCard('AI','Prompt, risposte e passaggio a operatore','OPENAI_API_KEY · ANTHROPIC_API_KEY · MODEL','Da configurare','ai')+
'</div><div class="section card security-card"><p class="eyebrow">PROTEZIONE CREDENZIALI</p><h2>Come vengono salvate</h2><p class="muted-copy">Token, password e QR non vengono conservati nel browser né nel codice pubblico. Ogni integrazione salva i valori esclusivamente nelle variabili protette Vercel/Railway; qui vedrai solo lo stato, il test di connessione e l’ultima sincronizzazione.</p></div>'}
function integrationCard(name,desc,keys,state,key){return '<div class="card integration-card"><div class="integration-head"><div class="integration-icon">'+({telegram:'✈',whatsapp:'◉',ringover:'☎',puprime:'◌',mt5:'▥',email:'✉',supabase:'◆',ai:'✦'}[key])+'</div><div><h3>'+name+'</h3><small>'+desc+'</small></div>'+status(state)+'</div><div class="key-line"><span>🔒</span><code>'+keys+'</code></div><div class="integration-actions">'+btn(key==='whatsapp'?'QR WhatsApp':'Configura','integration:'+key,'primary')+btn('Test','test:'+key)+'</div></div>'}
const integrationInfo={
 telegram:{name:'Telegram Bot',fields:'BOT_TOKEN · WEBHOOK_SECRET · ADMIN_CHAT_ID',text:'Il bot ufficiale, i deep link di campagna e i follow-up vengono gestiti dal gateway. Il token rimane nelle variabili protette Railway/Vercel.'},
 whatsapp:{name:'WhatsApp Business',fields:'PHONE_NUMBER_ID · ACCESS_TOKEN · VERIFY_TOKEN',text:'Per Cloud API si collegano numero Business, token e webhook. Il QR è necessario solo se si sceglie un dispositivo WhatsApp Business/Web; non viene mai generato o conservato dal browser CRM.'},
 ringover:{name:'Ringover',fields:'RINGOVER_API_KEY · RINGOVER_SECRET',text:'Abilita click-to-call dalla scheda lead, assegnazione chiamate e storico attività. Le chiavi restano lato server.'},
 puprime:{name:'PU Prime',fields:'PU_EMAIL · PU_PASSWORD · WORKER_SECRET',text:'Le credenziali vengono salvate esclusivamente nella VPS del worker con profilo browser persistente. Il CRM riceve solo dati sincronizzati e stato di sessione.'},
 mt5:{name:'MT5',fields:'MT5_LOGIN · MT5_PASSWORD · MT5_SERVER',text:'La VPS produce statistiche e screenshot firmati con data; il CRM espone report e autorizzazioni d’invio.'},
 email:{name:'Brevo Email',fields:'BREVO_API_KEY · SENDER · TEAM_RECIPIENTS',text:'Usata per avvisi personali al team, interventi umani, alert della sessione PU Prime e follow-up email ai clienti quando consentiti. Il mittente, le liste e le chiavi sono configurati dal server.'},
 supabase:{name:'Supabase',fields:'SUPABASE_URL · SERVER_SECRET · PROJECT_REF',text:'Database centrale per lead, chat, follow-up, campagne e replica dei dati PU Prime. Le chiavi server non raggiungono mai il frontend.'},
ai:{name:'AI conversazionale',fields:'OPENAI_API_KEY · ANTHROPIC_API_KEY · MODEL · RATE_LIMIT',text:'Puoi scegliere ChatGPT oppure Claude. Le chiavi restano esclusivamente nelle variabili protette del backend; nel CRM salvi solo provider, modello e impostazioni pubbliche.'}
};
async function showIntegration(key){let i=integrationInfo[key];if(!i)return;let {data}=dbReady?await db.from('crm_integrations').select('*').eq('provider',key).maybeSingle():{data:null},cfg=data?.public_config||{};let fields=key==='whatsapp'?'<label>Numero WhatsApp con prefisso</label><input name="phone" value="'+esc(cfg.phone||'')+'" placeholder="Es. 393331234567"><label>Messaggio iniziale</label><textarea name="message" placeholder="Ciao, vorrei informazioni su XAU Machine">'+esc(cfg.message||'Ciao, vorrei informazioni su XAU Machine')+'</textarea><div id="qr-live" class="qr-live hidden"><canvas></canvas><a id="wa-link" target="_blank">Apri WhatsApp</a></div>':key==='telegram'?'<label>Username pubblico del bot</label><input name="username" value="'+esc(cfg.username||'')+'" placeholder="Es. xaumachine_bot"><label>Chat ID notifiche amministratore</label><input name="admin_chat_id" value="'+esc(cfg.admin_chat_id||'')+'" placeholder="ID numerico">':key==='ai'?'<label>Provider AI</label><select name="provider"><option value="openai" '+(cfg.provider==='openai'?'selected':'')+'>ChatGPT / OpenAI</option><option value="anthropic" '+(cfg.provider==='anthropic'?'selected':'')+'>Claude / Anthropic</option></select><label>Modello</label><input name="model" value="'+esc(cfg.model||'')+'" placeholder="Es. modello economico per conversazioni"><label>Nome configurazione</label><input name="identifier" value="'+esc(cfg.identifier||'')+'" placeholder="Es. Bot conversazione XAU">':'<label>Identificativo pubblico / account</label><input name="identifier" value="'+esc(cfg.identifier||'')+'" placeholder="Nome account o riferimento (non la password)">';modal(i.name,'<form id="integration-form" class="integration-form"><p class="muted-copy">'+i.text+'</p>'+fields+'<div class="key-line secure-fields"><span>🔒</span><code>'+i.fields+'</code></div><div class="notice compact"><span>✓</span><div><b>Segreti protetti.</b><br>Token e password restano nelle variabili server Railway/Vercel; qui salvi solo dati pubblici e stato del collegamento.</div></div><div class="toolbar modal-actions">'+btn('Chiudi','close')+'<button class="primary" type="submit">Salva configurazione</button></div></form>');let form=document.querySelector('#integration-form');if(key==='whatsapp'){let make=()=>{let phone=form.phone.value.replace(/\D/g,''),msg=form.message.value,url='https://wa.me/'+phone+'?text='+encodeURIComponent(msg),box=document.querySelector('#qr-live');if(!phone){box.classList.add('hidden');return}box.classList.remove('hidden');document.querySelector('#wa-link').href=url;window.QRCode?.toCanvas(box.querySelector('canvas'),url,{width:220,margin:1})};form.phone.oninput=make;form.message.oninput=make;make()}form.onsubmit=async e=>{e.preventDefault();let f=new FormData(form),public_config=key==='whatsapp'?{phone:f.get('phone').replace(/\D/g,''),message:f.get('message')} : key==='telegram'?{username:f.get('username').replace(/^@/,''),admin_chat_id:f.get('admin_chat_id')}:key==='ai'?{provider:f.get('provider'),model:f.get('model'),identifier:f.get('identifier')}:{identifier:f.get('identifier')};let {error}=await db.from('crm_integrations').upsert({provider:key,display_name:i.name,public_config,connection_status:'configuration_saved',updated_at:new Date().toISOString()},{onConflict:'provider'});if(error)return toast(error.message);close();render('settings');toast(i.name+': configurazione salvata su Supabase.')}}
function testIntegration(key){if(key==='telegram')toast('Telegram: gateway operativo. Il test live sarà registrato nel CRM dopo il collegamento backend.');else toast('Test disponibile dopo il salvataggio protetto della configurazione '+(integrationInfo[key]?.name||'').trim()+'.')}
const pages={overview,leads,inbox,followups,automation,human,analytics,campaigns,channels,puprime,mt5,resources,prompts,team,settings};
const names={overview:'Panoramica',leads:'Lead',inbox:'Conversazioni',followups:'Follow-up',automation:'Regole & automazioni',human:'Intervento umano',analytics:'Analisi & CPA',campaigns:'Campagne',channels:'Canali & lingue',puprime:'PU Prime',mt5:'MT5 & risultati',resources:'Materiali & guide',prompts:'Prompt AI',team:'Team & ruoli',settings:'Impostazioni'};
function render(p=st.page){st.page=p;document.querySelector('#content').innerHTML=pages[p]();document.querySelector('#title').textContent=names[p];document.querySelector('#breadcrumb').textContent=p==='overview'?'CONTROLLO OPERATIVO':'XAU MACHINE CRM';document.querySelectorAll('#nav button').forEach(x=>x.classList.toggle('active',x.dataset.page===p));document.querySelector('.sidebar').classList.remove('open');bind()}
function bind(){document.querySelectorAll('[data-open]').forEach(x=>x.onclick=()=>{st.selected=x.dataset.open;render('inbox')});document.querySelectorAll('[data-chat]').forEach(x=>x.onclick=()=>{st.selected=x.dataset.chat;render('inbox')});document.querySelectorAll('[data-filter]').forEach(x=>x.onclick=()=>{st.filter=x.dataset.filter;render('leads')});let q=document.querySelector('#search'),f=document.querySelector('#filter'),form=document.querySelector('#send-form'),upload=document.querySelector('#upload-form'),promptForm=document.querySelector('#prompt-form');if(q)q.oninput=e=>{st.q=e.target.value;render('leads')};if(f)f.onchange=e=>{st.filter=e.target.value;render('leads')};let ppq=document.querySelector('#pp-search'),ppf=document.querySelector('#pp-filter');if(ppq)ppq.oninput=e=>{st.ppQ=e.target.value;render('puprime')};if(ppf)ppf.onchange=e=>{st.ppFilter=e.target.value;render('puprime')};if(form)form.onsubmit=async e=>{e.preventDefault();let v=document.querySelector('#message').value.trim(),cv=st.realConversations.find(x=>String(x.lead_id)===String(st.selected)),lead=st.leads.find(x=>String(x.id)===String(st.selected));if(!v)return;if(cv&&lead&&db){let chatId=String(lead.raw?.telegram_chat_id||lead.raw?.telegram_user_id||'');if(!chatId)return toast('Questo lead non ha un Telegram chat id.');let queued=await db.from('crm_operator_outbox').insert({tenant_id:'00000000-0000-4000-8000-000000000001',tenant_slug:'xau-machine',telegram_chat_id:chatId,body:v});if(queued.error)return toast('Invio Telegram non riuscito: '+queued.error.message);let saved=await db.from('crm_messages').insert({conversation_id:cv.id,tenant_id:'00000000-0000-4000-8000-000000000001',direction:'outbound',sender_type:'human',body:v});if(saved.error)return toast('Messaggio accodato ma cronologia non aggiornata: '+saved.error.message);await loadRealData();render('inbox');toast('Risposta inviata al bot Telegram.')}else{(st.msgs[st.selected]||=[]).push({who:'human',text:v,time:new Date().toLocaleTimeString('it-IT',{hour:'2-digit',minute:'2-digit'})});save();render('inbox');toast('Messaggio salvato localmente.')}};if(upload)upload.onsubmit=uploadMaterial;if(promptForm)promptForm.onsubmit=savePromptVersion;document.querySelectorAll('[data-prompt-lang]').forEach(x=>x.onchange=importPromptTxt)}
function toast(t){let e=document.querySelector('#toast');e.textContent=t;e.classList.add('show');setTimeout(()=>e.classList.remove('show'),3200)}
function modal(title,body){document.querySelector('#modal').innerHTML='<div class="modal-card"><div class="section-head"><div><p class="eyebrow">XAU MACHINE CRM</p><h2>'+title+'</h2></div>'+btn('×','close','icon')+'</div>'+body+'</div>';document.querySelector('#modal').classList.remove('hidden')}
function close(){document.querySelector('#modal').classList.add('hidden')}
function newLead(){modal('Nuovo lead','<form id="newlead"><label>Nome e cognome</label><input name="name" required placeholder="Es. Mario Rossi"><div class="form-two"><div><label>Campagna</label><select name="campaign"><option>Italia Gold</option><option>Serbia Signals</option><option>Spagna Agosto</option><option>Organico</option></select></div><div><label>Lingua</label><select name="lang"><option>IT</option><option>SR</option><option>ES</option><option>EN</option></select></div></div><label>Nota iniziale</label><textarea name="note" placeholder="Richiesta del lead"></textarea><div class="toolbar modal-actions">'+btn('Annulla','close')+btn('Crea lead','submitLead','primary')+'</div></form>');document.querySelector('#newlead').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target),payload={full_name:f.get('name').trim(),language:f.get('lang').toLowerCase(),product:'xau_machine',first_source:f.get('campaign'),last_source:f.get('campaign'),notes:f.get('note')||'Nuovo lead inserito dal CRM'};let {error}=await db.from('crm_leads').insert(payload);if(error)return toast('Errore: '+error.message);close();await loadRealData();render('leads');toast('Lead salvato realmente su Supabase.')}}
function newFollow(){modal('Programma follow-up','<form id="newfu"><label>Lead</label><select name="lead">'+st.leads.map(l=>'<option value="'+l.id+'">'+esc(l.name)+' · '+esc(l.stage)+'</option>').join('')+'</select><label>Quando</label><select name="when"><option>Tra 2 ore</option><option>Domani 10:00</option><option>Tra 3 giorni</option><option>Tra 7 giorni</option></select><label>Azione</label><select name="type"><option>Riprendi conversazione</option><option>Invia report aggiornato</option><option>Verifica registrazione</option><option>Richiama cliente</option></select><div class="toolbar modal-actions">'+btn('Annulla','close')+btn('Programma','submitFollow','primary')+'</div></form>');document.querySelector('#newfu').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target);st.followups.push({lead:+f.get('lead'),when:f.get('when'),type:f.get('type')});save();close();render('followups');toast('Follow-up programmato.')}}
function newCampaign(){modal('Nuova campagna','<form id="newcampaign"><label>Nome campagna</label><input name="name" required placeholder="Es. Italia Settembre"><div class="form-two"><div><label>Lingua</label><select name="lang"><option>IT</option><option>SR</option><option>ES</option><option>EN</option></select></div><div><label>Parametro link</label><input name="link" required placeholder="italia_settembre"></div></div><div class="toolbar modal-actions">'+btn('Annulla','close')+btn('Crea campagna','submitCampaign','primary')+'</div></form>');document.querySelector('#newcampaign').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target);st.campaigns.push({name:f.get('name'),lang:f.get('lang'),ch:'?start='+f.get('link'),n:0,ib:0});save();close();render('campaigns');toast('Campagna creata con link tracciabile.')}}
function newAdCost(){modal('Inserisci costo ads','<form id="newadcost"><label>Campagna</label><select name="campaign">'+[...new Set(st.leads.map(l=>l.campaign))].map(x=>'<option>'+esc(x)+'</option>').join('')+'</select><div class="form-two"><div><label>Canale</label><select name="channel"><option>Meta Ads</option><option>Google Ads</option><option>TikTok Ads</option><option>Telegram</option><option>Altro</option></select></div><div><label>Lingua</label><select name="lang"><option>IT</option><option>SR</option><option>ES</option><option>EN</option></select></div></div><label>Costo (€)</label><input name="cost" type="number" step="0.01" min="0" required placeholder="Es. 250.00"><label>Periodo / nota</label><input name="period" placeholder="Es. 1–7 settembre"><div class="toolbar modal-actions">'+btn('Annulla','close')+btn('Salva costo','submitAdCost','primary')+'</div></form>');document.querySelector('#newadcost').onsubmit=e=>{e.preventDefault();let f=new FormData(e.target);st.adcosts.push({id:Date.now(),campaign:f.get('campaign'),channel:f.get('channel'),lang:f.get('lang'),cost:+f.get('cost'),period:f.get('period')});save();close();render('analytics');toast('Costo ads registrato e attribuito alla campagna.')}}
function newChannel(){modal('Aggiungi canale Telegram','<form id="newchannel"><label>Nome canale</label><input name="name" required placeholder="Es. Serbia Gold"><label>Link del canale</label><input name="url" type="url" required placeholder="https://t.me/nomcanale"><div class="form-two"><div><label>Lingua</label><select name="language"><option value="it">Italiano</option><option value="en">Inglese</option><option value="es">Spagnolo</option><option value="sr">Serbo</option><option value="multi">Multilingua</option></select></div><div><label>Codice campagna</label><input name="code" required placeholder="serbia_gold"></div></div><label>Prodotto</label><select name="product"><option value="xau_machine">XAU Machine</option><option value="signal_room_b2b">Sala segnali B2B</option></select><div class="toolbar modal-actions">'+btn('Annulla','close')+'<button class="primary" type="submit">Salva canale</button></div></form>');document.querySelector('#newchannel').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target),code=String(f.get('code')).toLowerCase().trim().replace(/[^a-z0-9_]+/g,'_'),{error}=await db.from('crm_channel_sources').insert({name:f.get('name'),telegram_url:f.get('url'),language:f.get('language'),campaign_code:code,product:f.get('product')});if(error)return toast(error.message);close();await loadRealData();render('channels');toast('Canale salvato: usa ?start='+code)}}
function newRule(){
 modal('Nuova regola follow-up','<form id="newrule"><label>Nome regola</label><input name="name" required placeholder="Es. Iscritto · promemoria documenti"><div class="form-two"><div><label>Contesto cliente</label><select name="status"><option value="undecided_unregistered">Indeciso · non iscritto</option><option value="registered_not_deposited">Iscritto · non depositato</option><option value="deposited">Depositato</option></select></div><div><label>Canale</label><select name="channel"><option value="telegram">Telegram</option></select></div></div><div class="form-two"><div><label>Attesa</label><input name="delay" type="number" min="1" value="24" required></div><div><label>Unità</label><select name="unit"><option value="60">Ore</option><option value="1440">Giorni</option><option value="10080">Settimane</option><option value="43200">Mesi</option></select></div></div><label>Messaggio contestuale</label><textarea name="message" required placeholder="Ciao {nome}, ..."></textarea><small>Usa {nome} per inserire automaticamente il nome del cliente.</small><label><input name="stop" type="checkbox" checked> Interrompi quando il cliente risponde o non vuole essere contattato</label><div class="toolbar modal-actions">'+btn('Annulla','close')+'<button class="primary" type="submit">Salva e attiva</button></div></form>');
 document.querySelector('#newrule').onsubmit=async e=>{e.preventDefault();let f=new FormData(e.target),delay=Math.round(Number(f.get('delay'))*Number(f.get('unit')));if(!delay||delay<1)return toast('Inserisci una scadenza valida.');let {error}=await db.from('crm_followup_rules').insert({name:f.get('name'),trigger_event:'no_reply',lead_status:f.get('status'),delay_minutes:delay,channel:f.get('channel'),message_template:f.get('message'),stop_on_reply:f.get('stop')==='on',enabled:true});if(error)return toast(error.message);close();await loadRealData();render('automation');toast('Regola intelligente attivata.')};
}
async function importPromptTxt(e){let file=e.target.files[0],lang=e.target.dataset.promptLang,form=document.querySelector('#prompt-form'),info=document.querySelector('#prompt-file-status');if(!file)return;if(file.size>5*1024*1024){e.target.value='';return toast('Il file TXT supera 5 MB.')}try{let text=await file.text();if(!text.trim())throw new Error('Il file è vuoto');form.elements.content.value=text;form.elements.language.value=lang;form.elements.name.value='Prompt XAU Machine '+(lang==='it'?'Italiano':'English')+' · '+file.name.replace(/\.txt$/i,'');info.textContent=file.name+' importato · '+text.length.toLocaleString('it-IT')+' caratteri · controlla il testo e premi Salva.';toast('TXT '+(lang==='it'?'italiano':'inglese')+' importato nel prompt.')}catch(err){info.textContent='Impossibile leggere il file: '+err.message;toast('File TXT non leggibile.')}}
async function savePromptVersion(e){e.preventDefault();let f=new FormData(e.target),content=String(f.get('content')).trim(),language=String(f.get('language')),product=String(f.get('product')||'conversation');if(!content)return;let next=1+Math.max(0,...st.promptVersions.filter(x=>(x.product||'xau_machine')===product).map(x=>x.version||0));await db.from('crm_prompt_versions').update({active:false}).eq('product',product).eq('language',language);let {error}=await db.from('crm_prompt_versions').insert({name:f.get('name'),language,content,product,active:true,version:next});if(error)return toast(error.message);await loadRealData();render('prompts');toast('Prompt '+language.toUpperCase()+' v'+next+' salvato e attivato.')}
async function uploadMaterial(e){e.preventDefault();let form=e.target,file=form.elements.file.files[0],kind=form.elements.kind.value,statusEl=document.querySelector('#upload-status'),bar=document.querySelector('#upload-bar');if(!file)return;if(file.size>524288000)return toast('File oltre 500 MB.');let {data:{session}}=await db.auth.getSession();if(!session)return toast('Sessione scaduta: accedi di nuovo.');let clean=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path=new Date().toISOString().slice(0,10)+'/'+crypto.randomUUID()+'-'+clean;statusEl.textContent='Preparazione caricamento…';let upload=new tus.Upload(file,{endpoint:SB_URL+'/storage/v1/upload/resumable',retryDelays:[0,1000,3000,5000,10000],headers:{authorization:'Bearer '+session.access_token,apikey:SB_KEY,'x-upsert':'false'},uploadDataDuringCreation:true,removeFingerprintOnSuccess:true,chunkSize:6*1024*1024,metadata:{bucketName:'crm-materials',objectName:path,contentType:file.type||'application/octet-stream',cacheControl:'3600'},onError:err=>{statusEl.textContent='Errore: '+err.message;toast('Caricamento interrotto: puoi riprovare.')},onProgress:(sent,total)=>{let pct=Math.round(sent/total*100);bar.style.width=pct+'%';statusEl.textContent='Caricamento '+pct+'% · '+(sent/1048576).toFixed(1)+' di '+(total/1048576).toFixed(1)+' MB'},onSuccess:async()=>{let {error}=await db.from('crm_uploads').insert({kind,name:file.name,storage_path:path,mime_type:file.type,size_bytes:file.size,processing_status:'uploaded',processing_notes:'Caricato dal CRM; pronto per analisi'});if(error)return toast(error.message);await loadRealData();render('resources');toast('File caricato correttamente nel CRM.')}});let previous=await upload.findPreviousUploads();if(previous.length)upload.resumeFromPreviousUpload(previous[0]);upload.start()}
document.querySelectorAll('#nav button').forEach(x=>x.onclick=()=>render(x.dataset.page));document.querySelector('#menu').onclick=()=>document.querySelector('.sidebar').classList.toggle('open');
document.addEventListener('click',async e=>{let x=e.target.closest('[data-action]');if(!x)return;let a=x.dataset.action;if(a==='newlead')newLead();else if(a==='newfollow')newFollow();else if(a==='newcampaign')newCampaign();else if(a==='newadcost')newAdCost();else if(a==='newchannel')newChannel();else if(a==='newrule')newRule();else if(a==='close')close();else if(a==='submitLead')document.querySelector('#newlead').requestSubmit();else if(a==='submitFollow')document.querySelector('#newfu').requestSubmit();else if(a==='submitCampaign')document.querySelector('#newcampaign').requestSubmit();else if(a==='submitAdCost')document.querySelector('#newadcost').requestSubmit();else if(a==='saverules'){st.rules=document.querySelector('#rules').value;save();toast('Istruzione generale salvata.')}else if(a.startsWith('integration:'))showIntegration(a.slice(12));else if(a.startsWith('test:'))testIntegration(a.slice(5));else if(a.startsWith('go:'))render(a.slice(3));else if(a.startsWith('chat:')){st.selected=+a.slice(5);render('inbox')}else if(a.startsWith('take:')){let l=lead(a.slice(5));l.owner='Gaetano';l.priority='Alta';save();render();toast(l.name+': presa in carico.')}else if(a.startsWith('human:')){let l=lead(a.slice(6));l.owner='Operatore';l.priority='Alta';save();render('human');toast('Richiesta umana creata.')}else if(a.startsWith('follow:')){st.selected=+a.slice(7);newFollow()}else if(a.startsWith('cancel:')){await cancelFollowup(a.slice(7))}else if(a.startsWith('toast:'))toast(a.slice(6))});
/* Conversation rows must open even when an older mobile markup is present. */
document.addEventListener('click',e=>{
  const chat=e.target.closest('[data-chat]');
  const open=e.target.closest('[data-open]');
  const operational=e.target.closest('[data-open-chat]');
  if(!chat&&!open&&!operational)return;
  e.preventDefault();
  e.stopPropagation();
  const id=operational?.dataset.openChat||chat?.dataset.chat||open?.dataset.open;
  if(!id)return;
  st.selected=id;
  if(operational)st.mobileChatOpen=true;
  render('inbox');
},true);
document.addEventListener('click',async e=>{let x=e.target.closest('[data-action^="bot:"]');if(!x||!db)return;let id=x.dataset.action.slice(4),cv=st.realConversations.find(c=>String(c.id)===String(id)),lead=st.leads.find(l=>String(l.id)===String(cv?.lead_id));if(!cv||!lead)return;let chatId=String(lead.raw?.telegram_chat_id||lead.raw?.telegram_user_id||'');if(!chatId)return toast('Questo lead non ha un Telegram chat id.');let next=cv.ai_enabled===false,state=await db.from('crm_ai_state').upsert({tenant_id:'00000000-0000-4000-8000-000000000001',tenant_slug:'xau-machine',telegram_chat_id:chatId,ia_attiva:next,updated_at:new Date().toISOString()},{onConflict:'tenant_id,telegram_chat_id'});if(state.error)return toast('Impossibile aggiornare lo stato AI: '+state.error.message);let legacy=await db.from('crm_conversations').update({ai_enabled:next}).eq('id',cv.id);if(legacy.error)return toast('Stato AI salvato ma interfaccia legacy non aggiornata: '+legacy.error.message);await loadRealData();render('inbox');toast(next?'Bot riattivato':'Bot fermato')});
function enhanceChat(){
  const shell=document.querySelector('.chat-shell');
  if(!shell)return;
  const take=shell.querySelector('.ai-note .primary');
  if(take){take.textContent='🤖';take.title='Presa in carico AI';take.setAttribute('aria-label','Presa in carico AI');}
  if(!shell.querySelector('.quick-actions')){
    const form=shell.querySelector('#send-form');
    if(form){
      const q=document.createElement('div');
      q.className='quick-actions';
      q.innerHTML=['Richiesta IB','Depositato','Registrato','Cambio IB effettuato','Follow-up'].map((x,i)=>'<button type="button" class="quick-action qa-'+i+'" data-quick="'+x+'">'+x+'</button>').join('');
      form.parentNode.insertBefore(q,form);
      q.querySelectorAll('[data-quick]').forEach(b=>b.onclick=()=>{const input=form.querySelector('#message');input.value=b.dataset.quick+': ';input.focus()});
    }
  }
  shell.querySelectorAll('.msg').forEach(m=>{
    if(m.querySelector('.translate-link'))return;
    const text=m.querySelector('div')?.textContent?.trim();
    if(!text)return;
    const b=document.createElement('button');b.type='button';b.className='translate-link';b.textContent='Traduci';
    b.onclick=()=>toast('Traduzione: autorizza il provider esterno per attivarla.');
    m.appendChild(b);
  });
  const file=shell.querySelector('#attachment');
  if(file){
    file.accept='image/*,video/*';
    if(!file.dataset.bound){
      file.dataset.bound='1';
      const form=shell.querySelector('#send-form');
      form.addEventListener('submit',async e=>{
        const media=file.files?.[0];
        if(!media || !media.type.startsWith('video/'))return;
        e.preventDefault();e.stopImmediatePropagation();
        const lead=st.leads.find(x=>String(x.id)===String(st.selected));
        const cv=st.realConversations.find(x=>String(x.lead_id)===String(st.selected));
        const chatId=String(lead?.raw?.telegram_chat_id||lead?.raw?.telegram_user_id||'');
        if(!db||!lead||!cv||!chatId)return toast('Video non inviabile: conversazione Telegram non configurata.');
        const caption=(form.querySelector('#message')?.value||'').trim();
        const {data:{session}}=await db.auth.getSession();
        if(!session)return toast('Sessione scaduta: accedi di nuovo.');
        const path='operator-video/'+crypto.randomUUID()+'-'+media.name.replace(/[^a-zA-Z0-9._-]+/g,'_');
        const up=await db.storage.from('crm-materials').upload(path,media,{contentType:media.type,upsert:false});
        if(up.error)return toast('Caricamento video non riuscito: '+up.error.message);
        const signed=await db.storage.from('crm-materials').createSignedUrl(path,3600);
        if(signed.error)return toast('Link video non generato: '+signed.error.message);
        const tenant='00000000-0000-4000-8000-000000000001';
        const queued=await db.from('crm_operator_outbox').insert({tenant_id:tenant,tenant_slug:'xau-machine',telegram_chat_id:chatId,body:caption||'Video inviato dall’operatore',media_type:media.type,media_url:signed.data.signedUrl});
        if(queued.error)return toast('Invio video non riuscito: '+queued.error.message);
        const saved=await db.from('crm_messages').insert({conversation_id:cv.id,tenant_id:tenant,direction:'outbound',sender_type:'human',body:caption||'Video inviato dall’operatore',media_type:media.type,media_url:signed.data.signedUrl});
        if(saved.error)return toast('Video accodato ma cronologia non aggiornata: '+saved.error.message);
        file.value='';form.querySelector('#message').value='';await loadRealData();render('inbox');toast('Video accodato e inviato su Telegram.');
      },true);
    }
  }
}
const _renderWithChat=render;
render=(p=st.page)=>{_renderWithChat(p);enhanceChat()};
window.addEventListener('click',e=>{
  const chat=e.target.closest('[data-chat]');
  if(!chat)return;
  st.selected=chat.dataset.chat;
  render('inbox');
  setTimeout(()=>document.querySelector('.chat-shell')?.classList.add('mobile-chat-open'),0);
},true);
document.addEventListener('click',e=>{
  const a=e.target.closest('[data-action]')?.dataset.action;
  if(a==='mobile:list') document.querySelector('.chat-shell')?.classList.remove('mobile-chat-open');
  if(a==='refresh'){
    const b=e.target.closest('[data-action]');
    if(b){b.disabled=true;b.textContent='↻ Aggiornamento…';}
    loadRealData().finally(()=>{const n=document.querySelector('[data-action="refresh"]');if(n){n.disabled=false;n.textContent='↻ Aggiorna';}});
  }
});
document.addEventListener('click',e=>{
  const chat=e.target.closest('[data-chat]');
  if(chat){setTimeout(()=>document.querySelector('.chat-shell')?.classList.add('mobile-chat-open'),0);}
});
const passwordInput=document.querySelector('#auth-password');
if(passwordInput){
  const wrap=document.createElement('div');wrap.className='password-field';
  passwordInput.parentNode.insertBefore(wrap,passwordInput);wrap.appendChild(passwordInput);
  const show=document.createElement('button');show.type='button';show.id='show-password';show.textContent='Mostra';wrap.appendChild(show);
  show.onclick=()=>{const on=passwordInput.type==='text';passwordInput.type=on?'password':'text';show.textContent=on?'Mostra':'Nascondi';};
}
/* Inbox operativa: struttura Telegram/WhatsApp, non pagina CRM generica. */
const INBOX_LABELS=['Richiesta IB','Depositato','Registrato','Cambio IB','Follow-up'];
const labelClass=x=>['ib','deposit','registered','change','follow'][INBOX_LABELS.indexOf(x)]||'';
const conversationForLead=id=>st.realConversations.find(c=>String(c.lead_id)===String(id));
const listConversations=()=>st.realConversations.slice().sort((a,b)=>new Date(b.last_message_at||0)-new Date(a.last_message_at||0));
const stamp=v=>v?new Date(v).toLocaleString('it-IT',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'—';
function inboxOperational(){
  const filter=st.inboxFilter||'Tutti';
  const rows=listConversations().filter(c=>filter==='Tutti'||(c.labels||[]).includes(filter));
  const first=rows[0]||listConversations()[0];
  if(!st.selected&&first)st.selected=first.lead_id;
  const cv=conversationForLead(st.selected)||first;
  const leadRow=lead(cv?.lead_id);
  const messages=cv?st.realMessages.filter(m=>String(m.conversation_id)===String(cv.id)):[];
  const active=cv?.ai_enabled!==false;
  const preview=m=>cleanBody(m.body||'').replace(/\s+/g,' ').slice(0,55)||'Nessun messaggio';
  const filters=['Tutti',...INBOX_LABELS];
  return '<div class="tm-shell '+(st.mobileChatOpen?'mobile-open':'')+'">'
    +'<aside class="tm-list"><div class="tm-list-head"><b>Conversazioni</b><span>'+rows.length+'</span></div><div class="tm-filters">'+filters.map(f=>'<button class="tm-filter '+(filter===f?'active':'')+'" data-inbox-filter="'+f+'">'+f+'</button>').join('')+'</div><div class="tm-rows">'+(rows.length?rows.map(c=>{let l=lead(c.lead_id),last=st.realMessages.filter(m=>String(m.conversation_id)===String(c.id)).slice(-1)[0],tags=(c.labels||[]).map(x=>'<i class="tm-list-tag '+labelClass(x)+'">'+esc(x)+'</i>').join('');return '<button class="tm-row '+(String(c.lead_id)===String(cv?.lead_id)?'active':'')+'" data-open-chat="'+c.lead_id+'"><span class="avatar">'+l.i+'</span><span class="tm-row-main"><b>'+esc(l.name)+'</b><small>'+esc(preview(last||{}))+'</small><span class="tm-row-labels">'+tags+'</span></span><span class="tm-row-side"><time>'+stamp(c.last_message_at)+'</time><i class="tm-ai '+(c.ai_enabled===false?'off':'')+'"></i></span></button>'}).join(''):'<div class="empty">Nessuna chat per questo filtro.</div>')+'</div></aside>'
    +'<section class="tm-chat">'+(cv?'<header class="tm-chat-head"><button class="tm-back" data-inbox-back>‹</button><div class="avatar">'+leadRow.i+'</div><div class="tm-title"><b>'+esc(leadRow.name)+'</b><small><i class="tm-ai '+(active?'':'off')+'"></i> IA '+(active?'attiva':'disattivata')+' · '+stamp(cv.last_message_at)+'</small></div><button class="tm-translate-all" data-translate-all="'+encodeURIComponent(messages.map(m=>cleanBody(m.body||'')).filter(Boolean).join('\n\n'))+'">Traduci tutto</button><button class="tm-stop '+(active?'':'off')+'" data-action="bot:'+cv.id+'">'+(active?'Stop':'Avvia')+'</button></header>'
      +'<div class="tm-label-bar">'+INBOX_LABELS.map(t=>'<button class="tm-label '+labelClass(t)+((cv.labels||[]).includes(t)?' selected':'')+'" data-label="'+t+'" data-conversation="'+cv.id+'">'+t+'</button>').join('')+btn('＋ Follow-up','follow:'+leadRow.id,'tm-follow')+'</div>'
      +'<div class="tm-messages">'+(messages.length?messages.map(m=>{let media=m.media_url?(String(m.media_type||'').startsWith('video/')?'<video class="tm-media" controls src="'+esc(m.media_url)+'"></video>':'<img class="tm-media" src="'+esc(m.media_url)+'" alt="Allegato">'):'';return '<article class="tm-message '+(m.sender_type==='lead'?'incoming':'outgoing')+'"><div>'+esc(cleanBody(m.body||''))+'</div>'+media+'<small>'+esc(m.sender_type||'ai')+' · '+stamp(m.created_at)+'</small><button class="tm-translate" data-translate="'+encodeURIComponent(cleanBody(m.body||''))+'">Traduci</button></article>'}).join(''):'<div class="empty">Nessun messaggio.</div>')+'</div>'
      +'<form id="send-form" class="tm-compose"><label class="attach-button" title="Foto o video"><input id="attachment" type="file" accept="image/*,video/*">📎</label><input id="message" placeholder="Scrivi un messaggio" autocomplete="off" required><button class="primary" type="submit">Invia</button></form>'
      :'<div class="empty">Scegli una conversazione.</div>')+'</section></div>';
}
function overviewOperational(){
  const conv=listConversations(),now=new Date(),sameDay=d=>d&&new Date(d).toDateString()===now.toDateString(),sameMonth=d=>{let x=new Date(d);return d&&x.getFullYear()===now.getFullYear()&&x.getMonth()===now.getMonth()},lc=s=>String(s||'').toLowerCase(),pending=st.leads.filter(l=>/attesa|pending|check|verifica/.test(lc(l.raw?.puprime_status))).length,confirmed=st.leads.filter(l=>/verified|verificat|confirmed/.test(lc(l.raw?.puprime_status))).length,newChats=conv.filter(c=>sameDay(c.created_at)).length,monthChats=conv.filter(c=>sameMonth(c.created_at)).length,deps=st.leads.filter(l=>Number(l.raw?.deposit_total||0)>0),depToday=deps.filter(l=>sameDay(l.raw?.updated_at)).length,depMonth=deps.filter(l=>sameMonth(l.raw?.updated_at)).length,roomToday=st.leads.filter(l=>sameDay(l.raw?.room_access_granted_at)).length,roomMonth=st.leads.filter(l=>sameMonth(l.raw?.room_access_granted_at)).length,rebateToday=st.leads.filter(l=>sameDay(l.raw?.updated_at)).reduce((n,l)=>n+Number(l.raw?.rebate_total||0),0),usage=st.usage.find(x=>sameMonth(x.month))||{},cost=Number(usage.ai_cost||0),monthLeads=st.leads.filter(l=>sameMonth(l.raw?.created_at)).length;
  const dailySpend=st.adcosts.reduce((n,x)=>{let a=new Date(x.start||now),b=new Date(x.end||x.start||now),days=Math.max(1,Math.round((b-a)/86400000)+1);return n+(sameDay(x.start)||sameDay(x.end)||(a<=now&&b>=now)?Number(x.cost||0)/days:0)},0),monthlySpend=st.adcosts.reduce((n,x)=>n+(sameMonth(x.start)||sameMonth(x.end)?Number(x.cost||0):0),0),money=v=>'$'+Number(v||0).toLocaleString('it-IT',{maximumFractionDigits:2}),tile=(n,v,go,sub='')=>'<button class="kpi" data-action="go:'+go+'"><b>'+v+'</b><span>'+n+'</span><small>'+esc(sub||'Apri ›')+'</small></button>';
  return '<section class="kpi-grid kpi-operational">'+tile('Rebate totale oggi',money(rebateToday),'puprime','aggiornato oggi')+tile('Nuove chat oggi',newChats,'inbox','totale mese: '+monthChats)+tile('Chat mese corrente',monthChats,'inbox')+tile('IB da confermare',pending,'inbox','verifica PU Prime')+tile('IB confermati',confirmed,'inbox')+tile('Depositati oggi',depToday,'inbox','sincronizzati oggi')+tile('Depositati mese',depMonth,'inbox')+tile('Nuovi sala segnali',roomToday,'inbox','accessi oggi')+tile('Sala segnali mese',roomMonth,'inbox')+tile('CPA × lead oggi',newChats?money(dailySpend/newChats):'—','analytics','spesa / nuove chat')+tile('CPA medio mensile',monthLeads?money(monthlySpend/monthLeads):'—','analytics')+tile('Token · spesi mese',money(cost),'settings','costo AI effettivo')+'</section>';
}
pages.inbox=inboxOperational;
pages.overview=overviewOperational;

async function loadChannelKpiData(){
  if(!db)return;
  const [{data:events,error:eventError},{data:campaignRows,error:campaignError}]=await Promise.all([
    db.from('crm_channel_join_events').select('*').order('requested_at',{ascending:false}).limit(5000),
    db.from('crm_campaigns').select('*').eq('active',true).order('created_at',{ascending:false})
  ]);
  st.channelJoinEvents=events||[];
  st.campaignRecords=campaignRows||[];
  if(eventError)console.error('[channel-kpi] eventi canale non caricati',eventError);
  if(campaignError)console.error('[channel-kpi] campagne non caricate',campaignError);
}
function channelLead(event){
  const telegramId=String(event?.telegram_user_id||'');
  return telegramId?st.leads.find(l=>String(l.raw?.telegram_user_id||l.raw?.telegram_chat_id||'')===telegramId):null;
}
function channelConversation(event){
  const l=channelLead(event);
  return l?st.realConversations.find(c=>String(c.lead_id)===String(l.id)):null;
}
function channelCampaignFor(source,events=[]){
  const eventSource=events.find(e=>e.source)?.source;
  if(eventSource){
    const exact=st.campaignRecords.find(c=>c.deep_link_code===eventSource);
    if(exact)return exact;
  }
  const key=String(source?.campaign_code||'').replace(/_english$/,'').replace(/_trading$/,'');
  return st.campaignRecords.find(c=>String(c.source_channel||'').includes(key)||String(c.deep_link_code||'').includes(key));
}
function channelKpiRows(){
  const approved=e=>Boolean(e.approved_at)||String(e.status||'').toLowerCase()==='approved';
  return (st.channelSources||[]).map(source=>{
    const events=(st.channelJoinEvents||[]).filter(e=>String(e.invite_link||'')===String(source.telegram_url||''));
    const approvedEvents=events.filter(approved),chatEvents=approvedEvents.filter(channelConversation);
    const leads=[...new Map(approvedEvents.map(e=>channelLead(e)).filter(Boolean).map(l=>[String(l.id),l])).values()];
    const campaign=channelCampaignFor(source,events);
    return {source,campaign,events,requested:events.reduce((n,e)=>n+Number(e.request_count||1),0),entered:approvedEvents.length,welcomed:approvedEvents.filter(e=>e.welcome_sent_at).length,chats:chatEvents.length,conversion:approvedEvents.length?chatEvents.length/approvedEvents.length:0,ib:leads.filter(l=>/verified|verificat|confirmed/.test(String(l.raw?.puprime_status||'').toLowerCase())).length,deposits:leads.filter(l=>Number(l.raw?.deposit_total||0)>0).length,rebate:leads.reduce((n,l)=>n+Number(l.raw?.rebate_total||0),0)};
  });
}
function channelKpiTile(label,value,sub=''){
  return '<button class="kpi" data-action="go:channels"><b>'+esc(value)+'</b><span>'+esc(label)+'</span><small>'+esc(sub||'Apri dettaglio per canale ›')+'</small></button>';
}
function overviewWithChannelKpis(){
  const now=new Date(),sameDay=d=>d&&new Date(d).toDateString()===now.toDateString(),sameMonth=d=>{const x=new Date(d);return d&&x.getFullYear()===now.getFullYear()&&x.getMonth()===now.getMonth()},approved=e=>Boolean(e.approved_at)||String(e.status||'').toLowerCase()==='approved',events=st.channelJoinEvents||[],today=events.filter(e=>approved(e)&&sameDay(e.approved_at||e.requested_at)),month=events.filter(e=>approved(e)&&sameMonth(e.approved_at||e.requested_at)),todayChats=today.filter(e=>{const c=channelConversation(e);return c&&sameDay(c.created_at)}).length,monthChats=month.filter(channelConversation).length,conversion=month.length?Math.round(monthChats/month.length*100):0;
  return '<section class="section channel-kpi-block"><div class="section-head"><div><p class="eyebrow">ACQUISIZIONE TELEGRAM</p><h2>Ingressi e chat dai canali</h2></div>'+btn('Dettaglio campagne','go:channels')+'</div><div class="kpi-grid">'+channelKpiTile('Ingressi canali oggi',today.length,'approvati oggi')+channelKpiTile('Ingressi canali mese',month.length,'utenti approvati')+channelKpiTile('Chat avviate oggi',todayChats,'provenienti dai canali')+channelKpiTile('Conversione ingresso → chat',conversion+'%','mese corrente')+'</div></section>'+overviewOperational();
}
function channelsOperational(){
  const rows=channelKpiRows(),totals=rows.reduce((a,r)=>({requested:a.requested+r.requested,entered:a.entered+r.entered,chats:a.chats+r.chats,ib:a.ib+r.ib,deposits:a.deposits+r.deposits,rebate:a.rebate+r.rebate}),{requested:0,entered:0,chats:0,ib:0,deposits:0,rebate:0}),conversion=totals.entered?Math.round(totals.chats/totals.entered*100):0,money=v=>'$'+Number(v||0).toLocaleString('it-IT',{maximumFractionDigits:2});
  return '<div class="notice"><span>▤</span><div><b>KPI separati per canale e campagna.</b><br>Gli ingressi contano gli utenti approvati; le chat vengono attribuite collegando lo stesso utente Telegram al lead nel CRM.</div></div>'+
    '<section class="kpi-grid section">'+channelKpiTile('Richieste totali',totals.requested,'incluse richieste ripetute')+channelKpiTile('Utenti entrati',totals.entered,'accessi approvati')+channelKpiTile('Chat iniziate',totals.chats,'lead nel CRM')+channelKpiTile('Conversione totale',conversion+'%','ingresso → chat')+'</section>'+
    '<section class="section"><div class="section-head"><div><p class="eyebrow">CAMPAGNE TELEGRAM</p><h2>Risultati per canale</h2></div>'+btn('+ Aggiungi canale Telegram','newchannel','primary')+'</div><div class="card table-card"><div class="table-wrap"><table class="channel-kpi-table"><thead><tr><th>CANALE / CAMPAGNA</th><th>LINGUA</th><th>RICHIESTE</th><th>ENTRATI</th><th>BENVENUTO</th><th>CHAT</th><th>CONVERSIONE</th><th>IB</th><th>DEPOSITI</th><th>REBATE</th></tr></thead><tbody>'+
    (rows.length?rows.map(r=>'<tr><td><b>'+esc(r.source.name)+'</b><small>'+esc(r.campaign?.name||r.source.campaign_code||'Campagna')+'</small><a href="'+esc(r.source.telegram_url)+'" target="_blank" rel="noreferrer">Apri canale ↗</a></td><td>'+status(String(r.source.language||'—').toUpperCase())+'</td><td><b>'+r.requested+'</b></td><td><b>'+r.entered+'</b></td><td><b>'+r.welcomed+'</b></td><td><b>'+r.chats+'</b></td><td><b>'+Math.round(r.conversion*100)+'%</b></td><td><b>'+r.ib+'</b></td><td><b>'+r.deposits+'</b></td><td><b>'+money(r.rebate)+'</b></td></tr>').join(''):'<tr><td colspan="10" class="empty">Nessun canale configurato.</td></tr>')+
    '</tbody></table></div></div></section>';
}
pages.overview=overviewWithChannelKpis;
pages.channels=channelsOperational;
async function cancelFollowup(id){
 if(!db)return toast('Database non disponibile.');
 const {error}=await db.from('crm_followups').update({cancelled_at:new Date().toISOString(),cancellation_reason:'cancelled_by_operator',updated_at:new Date().toISOString()}).eq('id',id).is('sent_at',null);
 if(error)return toast('Follow-up non annullato: '+error.message);
 await loadRealData();render('followups');toast('Follow-up annullato.');
}
/* Follow-up reale: la programmazione viene inserita in Supabase, non resta nel browser. */
newFollow=()=>{
 const selected=st.selected||st.leads[0]?.id||'';
 const rules=(st.followRules||[]).filter(r=>r.enabled!==false&&r.trigger_event==='no_reply');
 modal('Programma follow-up','<form id="newfu-real"><label>Cliente</label><select name="lead">'+st.leads.map(l=>'<option value="'+l.id+'" '+(String(l.id)===String(selected)?'selected':'')+'>'+esc(l.name)+'</option>').join('')+'</select><label>Quando</label><select name="delay"><option value="120">Dopo 2 ore</option><option value="1440">Dopo 24 ore</option><option value="2880">Dopo 48 ore</option><option value="10080">Tra una settimana</option><option value="43200">Tra un mese</option></select><label>Contesto / messaggio</label><select name="rule">'+rules.map(r=>'<option value="'+r.id+'">'+esc(followupSegmentLabel(r.lead_status))+' · '+esc(r.name)+'</option>').join('')+'</select><div class="toolbar modal-actions">'+btn('Annulla','close')+'<button class="primary" type="submit">Programma</button></div></form>');
 document.querySelector('#newfu-real').onsubmit=async e=>{e.preventDefault();if(!db)return toast('Database non disponibile.');const f=new FormData(e.target),rule=rules.find(r=>String(r.id)===String(f.get('rule'))),delay=Number(f.get('delay')),scheduled=new Date(Date.now()+delay*60000).toISOString();if(!rule)return toast('Seleziona una regola valida.');const {error}=await db.from('crm_followups').insert({lead_id:f.get('lead'),sequence_key:rule.name,step_number:[120,1440,2880,10080,43200].indexOf(delay)+1,scheduled_for:scheduled,channel:'telegram',rule_id:rule.id,anchor_message_at:new Date().toISOString()});if(error)return toast('Follow-up non salvato: '+error.message);close();await loadRealData();render('followups');toast('Follow-up programmato.');};
};
let crmRealtime,realtimeReload;
function subscribeCRMRealtime(){
  if(crmRealtime||!db)return;
  const refresh=()=>{clearTimeout(realtimeReload);realtimeReload=setTimeout(()=>loadRealData(),350);};
  crmRealtime=db.channel('crm-live-inbox').on('postgres_changes',{event:'*',schema:'public',table:'crm_messages'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'crm_conversations'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'crm_leads'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'crm_followups'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'crm_channel_join_events'},refresh).on('postgres_changes',{event:'*',schema:'public',table:'puprime_clienti'},refresh).subscribe();
}
/* Foto e video: caricamento protetto su Storage, quindi coda Telegram e cronologia della conversazione. */
document.addEventListener('submit',async e=>{
  const form=e.target;
  if(!form.matches('#send-form.tm-compose'))return;
  const file=form.querySelector('#attachment')?.files?.[0];
  if(!file)return;
  e.preventDefault();e.stopImmediatePropagation();
  const cv=conversationForLead(st.selected),leadRow=lead(st.selected),chatId=String(leadRow?.raw?.telegram_chat_id||leadRow?.raw?.telegram_user_id||'');
  if(!db||!cv||!chatId)return toast('Allegato non inviabile: manca la conversazione Telegram.');
  const caption=(form.querySelector('#message')?.value||'').trim(),safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path='operator-media/'+crypto.randomUUID()+'-'+safe;
  const upload=await db.storage.from('crm-materials').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});
  if(upload.error)return toast('Caricamento non riuscito: '+upload.error.message);
  const signed=await db.storage.from('crm-materials').createSignedUrl(path,3600);
  if(signed.error)return toast('Link allegato non generato: '+signed.error.message);
  const tenant='00000000-0000-4000-8000-000000000001',body=caption||(file.type.startsWith('video/')?'Video inviato dall’operatore':'Foto inviata dall’operatore');
  const queued=await db.from('crm_operator_outbox').insert({tenant_id:tenant,tenant_slug:'xau-machine',telegram_chat_id:chatId,body,media_type:file.type,media_url:signed.data.signedUrl});
  if(queued.error)return toast('Allegato non accodato: '+queued.error.message);
  const saved=await db.from('crm_messages').insert({conversation_id:cv.id,tenant_id:tenant,direction:'outbound',sender_type:'human',body,media_type:file.type,media_url:signed.data.signedUrl});
  if(saved.error)return toast('Allegato inviato ma cronologia non aggiornata: '+saved.error.message);
  form.querySelector('#attachment').value='';form.querySelector('#message').value='';await loadRealData();render('inbox');toast(file.type.startsWith('video/')?'Video inviato su Telegram.':'Foto inviata su Telegram.');
},true);
window.addEventListener('click',async e=>{
  const filter=e.target.closest('[data-inbox-filter]');
  if(filter){e.preventDefault();e.stopPropagation();st.inboxFilter=filter.dataset.inboxFilter;st.mobileChatOpen=false;render('inbox');return;}
  const open=e.target.closest('[data-open-chat]');
  if(open){e.preventDefault();e.stopPropagation();st.selected=open.dataset.openChat;st.mobileChatOpen=true;render('inbox');return;}
  const back=e.target.closest('[data-inbox-back]');
  if(back){e.preventDefault();e.stopPropagation();st.mobileChatOpen=false;render('inbox');return;}
  const tag=e.target.closest('[data-label]');
  if(tag&&db){e.preventDefault();e.stopPropagation();const id=tag.dataset.conversation,cv=st.realConversations.find(c=>String(c.id)===String(id));if(!cv)return;const label=tag.dataset.label,labels=new Set(cv.labels||[]);labels.has(label)?labels.delete(label):labels.add(label);const {error}=await db.from('crm_conversations').update({labels:[...labels]}).eq('id',id);if(error)return toast('Etichetta non salvata: '+error.message);cv.labels=[...labels];render('inbox');return;}
  const tr=e.target.closest('[data-translate]');
  if(tr){e.preventDefault();e.stopPropagation();const text=decodeURIComponent(tr.dataset.translate||'');if(!text)return;window.open('https://translate.google.com/?sl=auto&tl=it&text='+encodeURIComponent(text)+'&op=translate','_blank','noopener');}
  const all=e.target.closest('[data-translate-all]');
  if(all){e.preventDefault();e.stopPropagation();const text=decodeURIComponent(all.dataset.translateAll||'');if(!text)return;window.open('https://translate.google.com/?sl=auto&tl=it&text='+encodeURIComponent(text)+'&op=translate','_blank','noopener');}
},true);
const _renderWithInboxPosition=render;
render=(p=st.page)=>{_renderWithInboxPosition(p);if(p==='inbox'||st.page==='inbox')requestAnimationFrame(()=>{const list=document.querySelector('.tm-messages');if(list)list.scrollTop=list.scrollHeight;});};
const loadRealDataCore=loadRealData;
loadRealData=async function(){
  await loadRealDataCore();
  await loadChannelKpiData();
  render(st.page);
};
render();bootAuth();
/* Campagne broadcast manuali: il testo viene sempre scritto dall'operatore. */
const BROADCAST_FILTERS=[
  ['all','Tutti gli utenti'],
  ['new_lead','Nuovi lead'],
  ['indecisi','Indecisi'],
  ['ib_request','Richiesta IB'],
  ['ib_pending','IB da confermare'],
  ['ib_confirmed','IB confermato'],
  ['registered','Registrati'],
  ['registered_no_deposit','Registrati · non depositati'],
  ['deposit','Depositati'],
  ['activated','Attivati'],
  ['change_ib','Cambio IB effettuato'],
  ['followup','Follow-up'],
  ['human','Richiesta umana'],
  ['not_interested','Non interessati'],
  ['older_90','Più vecchi di 90 giorni']
];
function broadcastConversation(c){return c||{};}
function broadcastLeadMatches(l,filter,cv){
  const r=l.raw||{}, s=String(r.status||l.stage||'').toLowerCase(), ib=String(r.puprime_status||l.ib||'').toLowerCase(), labels=(cv?.labels||[]).map(x=>String(x).toLowerCase());
  const dep=Number(r.deposit_total||0)>0 || /deposit|depos|funded/.test(s);
  const activated=/active|attiv|accesso|enabled|copied/.test(s) || Boolean(r.room_access_granted_at);
  const registered=/registr|verified|verificat|ib/.test(s+' '+ib) || /registr|verificat/.test(ib);
  const has=(...xs)=>xs.some(x=>labels.includes(x));
  const created=new Date(r.created_at||0);
  if(filter==='all') return true;
  if(filter==='new_lead') return has('nuovo lead','nuovi lead') || /^(new|nuovo|nuovo lead)$/.test(s);
  if(filter==='indecisi') return (labels.includes('indeciso')||labels.includes('indecisi')) || (!dep&&!activated&&!registered && s!=='non_interested' && s!=='non interessato');
  if(filter==='ib_request') return has('richiesta ib','ib richiesto') || /richiest.*ib|ib.*richiest/.test(s+' '+ib);
  if(filter==='ib_pending') return has('ib da confermare','in attesa','in verifica') || /attesa|pending|in verifica|da confermare/.test(ib);
  if(filter==='ib_confirmed') return has('ib confermato','ib confermati','ib verificato') || /verified|verificat|confermat/.test(ib);
  if(filter==='registered') return has('registrato','registrati','iscritto','iscritti') || registered;
  if(filter==='registered_no_deposit') return (labels.includes('registrato')||labels.includes('registrati'))&&!dep || (registered&&!dep);
  if(filter==='deposit') return has('depositato','depositati') || dep;
  if(filter==='activated') return labels.includes('attivato')||labels.includes('attivati')||activated;
  if(filter==='change_ib') return has('cambio ib effettuato','cambio ib') || /cambio.*ib/.test(s+' '+ib);
  if(filter==='followup') return has('follow-up','followup') || /follow.?up/.test(s);
  if(filter==='human') return has('richiesta umana','intervento umano') || /human|operatore|intervento/.test(s);
  if(filter==='not_interested') return has('non interessato','non interessati') || /non.?interess/.test(s);
  if(filter==='older_90') return created.toString()!=='Invalid Date' && created.getTime()<=Date.now()-90*86400000;
  return false;
}
function broadcastTargets(filter){
  const cvs=st.realConversations||[];
  return st.leads.map(l=>({lead:l,cv:cvs.find(c=>String(c.lead_id)===String(l.id))})).filter(x=>broadcastLeadMatches(x.lead,filter,x.cv)&&x.cv&&String(x.lead.raw?.telegram_chat_id||x.lead.raw?.telegram_user_id||''));
}
function broadcastModal(){
  modal('Invia a tutti','<form id="broadcast-form"><label>Destinatari</label><select name="filter">'+BROADCAST_FILTERS.map(x=>'<option value="'+x[0]+'">'+x[1]+'</option>').join('')+'</select><div id="broadcast-count" class="notice compact">Seleziona un filtro per vedere i destinatari.</div><label>Messaggio da inviare</label><textarea name="body" required placeholder="Scrivi qui il messaggio che vuoi inviare…"></textarea><label>Foto o video dei risultati (facoltativo)</label><input name="media" type="file" accept="image/*,video/*"><small>Prima dell’invio vedrai il numero dei destinatari. Verranno esclusi automaticamente contatti senza Telegram, AI disattivata o già esclusi.</small><div class="toolbar modal-actions">'+btn('Annulla','close')+'<button class="primary" type="submit">Anteprima invio</button></div></form>');
  const form=document.querySelector('#broadcast-form'), count=document.querySelector('#broadcast-count');
  const update=()=>{const n=broadcastTargets(form.filter.value).length;count.textContent='Destinatari trovati: '+n;count.dataset.count=n;};
  form.filter.onchange=update; update();
  form.onsubmit=async e=>{e.preventDefault();const targets=broadcastTargets(form.filter.value),body=String(form.body.value||'').trim(),file=form.media.files?.[0];if(!body)return toast('Scrivi prima il messaggio.');if(!targets.length)return toast('Nessun destinatario valido per questo filtro.');
    const ask=window.confirm('Confermi l’invio a '+targets.length+' destinatari?');if(!ask)return;
    const tenant='00000000-0000-4000-8000-000000000001';let media=null;
    if(file){const safe=file.name.replace(/[^a-zA-Z0-9._-]+/g,'_'),path='broadcast-media/'+crypto.randomUUID()+'-'+safe,up=await db.storage.from('crm-materials').upload(path,file,{contentType:file.type||'application/octet-stream',upsert:false});if(up.error)return toast('Caricamento allegato non riuscito: '+up.error.message);const signed=await db.storage.from('crm-materials').createSignedUrl(path,3600);if(signed.error)return toast('Link allegato non generato: '+signed.error.message);media={type:file.type,url:signed.data.signedUrl};}
    let ok=0,fail=0;for(const item of targets){const chatId=String(item.lead.raw?.telegram_chat_id||item.lead.raw?.telegram_user_id||'');const payload={tenant_id:tenant,tenant_slug:'xau-machine',telegram_chat_id:chatId,body, ...(media?{media_type:media.type,media_url:media.url}:{})};const q=await db.from('crm_operator_outbox').insert(payload);if(q.error){fail++;continue;}const saved=await db.from('crm_messages').insert({conversation_id:item.cv.id,tenant_id:tenant,direction:'outbound',sender_type:'human',body, ...(media?{media_type:media.type,media_url:media.url}:{})});q.error||saved.error?fail++:ok++;}
    close();await loadRealData();render('campaigns');toast('Invio completato: '+ok+' riusciti'+(fail?' · '+fail+' da verificare':''));
  };
}
const _campaignsBeforeBroadcast=pages.campaigns;
pages.campaigns=()=>{const base=_campaignsBeforeBroadcast();return base.replace('<div class="toolbar">','<div class="toolbar">'+btn('✈ Invia a tutti','broadcast','primary') );};
document.addEventListener('click',e=>{const x=e.target.closest('[data-action]');if(x?.dataset.action==='broadcast')broadcastModal();});

/* Importazione manuale dell'export PU Prime (CSV/XLS/XLSX).
   Il file viene letto nel browser; al database arrivano soltanto le colonne normalizzate. */
const PP_IMPORT_ALIASES={
  data_registrazione:['data','dataregistrazione','registrationdate','registeredat','regdate','dataapertura'],
  id_utente:['idutente','userid','userno','clientid','customerid','idcliente'],
  numero_conto:['numeroconto','accountnumber','accountno','tradingaccount','mt5account','mt4account','conto','account'],
  nome:['nome','fullname','clientname','customername','name','nomecliente'],
  fonte_campagna:['fontedellacampagna','campaignsource','sourcecampaign'],
  titolare_account:['titolaredellaccount','titolareaccount','accountowner'],
  tipo_conto:['tipodiconto','tipoconto','accounttype'],
  piattaforma:['piattaforma','platform'],
  valuta_base:['valutadibase','valutabase','basecurrency'],
  saldo_conto:['saldoconto','accountbalance'],
  credito:['credito','credit'],
  percorso_account:['percorsodellaccount','percorsoaccount','accountpath'],
  data_ultima_operazione:['datadellultimaoperazione','dataultimaoperazione','lasttradedate'],
  ultimo_strumento:['ultimostrumentonegoziato','ultimostrumento','lasttradedsymbol'],
  ultimi_lotti:['ultimilottiscambiati','ultimilotti','lasttradedlots'],
  affiliate_id:['idaffiliatosuperiore','affiliateid','parentaffiliateid'],
  stato_id:['statoid','idstatus','identitystatus','idverificationstatus','statoidentita','kycstatus'],
  stato_poa:['statopoa','poastatus','proofofaddressstatus','addressverificationstatus'],
  attivo:['attivo','active','isactive','enabled'],
  rebate:['rebate','sconto','commission','commissione'],
  rebate_aggiornato:['rebateaggiornato','rebatedate','datasconto'],
  canale:['canale','channel','source'],
  email:['email','emailaddress','indirizzoemail'],
  telefono:['telefono','phone','mobile','phonenumber','cellulare'],
  saldo:['saldo','balance','accountbalance'],
  primo_deposito_data:['primodepositodata','firstdepositdate','ftddate'],
  ultimo_deposito_data:['datadellultimodeposito','ultimodepositodata','lastdepositdate','latestdepositdate'],
  ultimo_deposito_importo:['importodellultimodeposito','ultimodepositoimporto','lastdepositamount','latestdepositamount','depositamount'],
  ultimo_deposito_valuta:['ultimodepositovaluta','depositcurrency','currency','valuta'],
  stato:['stato','status','clientstatus','accountstatus'],
  data_prima_operazione:['dataprimaoperazione','firsttradedate','firsttransactiondate']
};
const ppHeader=v=>String(v??'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^a-z0-9]+/g,'');
const PP_IMPORT_HEADER_MAP=Object.entries(PP_IMPORT_ALIASES).reduce((m,[field,names])=>{names.forEach(n=>m[n]=field);return m;},{});
const ppImportNumber=value=>{let s=String(value??'').trim().replace(/[^0-9,.'-]/g,'').replace(/'/g,'');if(!s)return null;const comma=s.lastIndexOf(','),dot=s.lastIndexOf('.');if(comma>=0&&dot>=0)s=comma>dot?s.replace(/\./g,'').replace(',','.'):s.replace(/,/g,'');else if(comma>=0)s=s.replace(/\./g,'').replace(',','.');const n=Number(s);return Number.isFinite(n)?n:null;};
const ppImportBoolean=value=>{const s=ppHeader(value);if(!s)return null;if(['true','1','si','yes','attivo','active','enabled'].includes(s))return true;if(['false','0','no','nonattivo','inactive','disabled'].includes(s))return false;return null;};
const ppImportDate=value=>{if(value==null||String(value).trim()==='')return null;const d=value instanceof Date?value:new Date(value);return Number.isNaN(d.getTime())?null:d.toISOString().slice(0,10);};
let ppImportRowsPending=[],ppImportFileName='';

function ppNormalizeImport(grid){
  const headerIndex=grid.slice(0,25).findIndex(row=>row.some(cell=>PP_IMPORT_HEADER_MAP[ppHeader(cell)]==='numero_conto'));
  if(headerIndex<0)throw new Error('Non trovo la colonna Numero conto / Account number.');
  const fields=grid[headerIndex].map(h=>PP_IMPORT_HEADER_MAP[ppHeader(h)]||null);
  const rows=[];
  for(const raw of grid.slice(headerIndex+1)){
    const out={};fields.forEach((field,i)=>{if(field)out[field]=raw[i]??null;});
    out.numero_conto=String(out.numero_conto??'').trim();
    if(!out.numero_conto)continue;
    ['data_registrazione','id_utente','nome','stato_id','stato_poa','canale','email','telefono','primo_deposito_data','ultimo_deposito_data','ultimo_deposito_valuta','stato','fonte_campagna','titolare_account','tipo_conto','piattaforma','valuta_base','percorso_account','data_ultima_operazione','ultimo_strumento','ultimi_lotti','affiliate_id'].forEach(k=>{out[k]=String(out[k]??'').trim()||null;});
    ['rebate','saldo','saldo_conto','credito','ultimo_deposito_importo'].forEach(k=>out[k]=ppImportNumber(out[k]));
    out.attivo=ppImportBoolean(out.attivo);
    out.rebate_aggiornato=ppImportDate(out.rebate_aggiornato);
    out.data_prima_operazione=ppImportDate(out.data_prima_operazione);
    rows.push(out);
  }
  const unique=new Map();rows.forEach(row=>unique.set(row.numero_conto,row));
  return [...unique.values()];
}

async function ppReadImportFile(file){
  if(!window.XLSX)throw new Error('Lettore Excel non disponibile: aggiorna la pagina e riprova.');
  if(file.size>15*1024*1024)throw new Error('Il file supera il limite di 15 MB.');
  const data=await file.arrayBuffer(),book=XLSX.read(data,{type:'array',cellDates:true}),sheet=book.Sheets[book.SheetNames[0]];
  if(!sheet)throw new Error('Il file non contiene fogli leggibili.');
  return ppNormalizeImport(XLSX.utils.sheet_to_json(sheet,{header:1,defval:'',raw:false,blankrows:false}));
}

function ppShowImportPreview(rows,file){
  ppImportRowsPending=rows;ppImportFileName=file.name;
  const sample=rows.slice(0,8),money=v=>v==null?'—':Number(v).toLocaleString('it-IT',{maximumFractionDigits:2});
  modal('Anteprima importazione PU Prime','<div class="pp-import-summary"><b>'+esc(file.name)+'</b><span>'+rows.length+' clienti validi · abbinamento per numero conto</span></div><div class="table-wrap pp-import-preview"><table><thead><tr><th>NOME</th><th>ID UTENTE</th><th>N. CONTO</th><th>EMAIL</th><th>SALDO</th><th>ULTIMO DEPOSITO</th></tr></thead><tbody>'+sample.map(r=>'<tr><td>'+esc(r.nome||'—')+'</td><td>'+esc(r.id_utente||'—')+'</td><td><b>'+esc(r.numero_conto)+'</b></td><td>'+esc(r.email||'—')+'</td><td>'+money(r.saldo)+'</td><td>'+money(r.ultimo_deposito_importo)+'</td></tr>').join('')+'</tbody></table></div><div class="notice compact"><span>✓</span><div>Le righe già presenti saranno aggiornate. Le nuove saranno aggiunte. Nessun cliente assente dal file verrà cancellato.</div></div><div class="toolbar modal-actions">'+btn('Annulla','close')+'<button id="pp-import-confirm" class="primary" type="button">Conferma importazione</button></div>');
  document.querySelector('#pp-import-confirm').onclick=ppConfirmImport;
}

async function ppConfirmImport(){
  const button=document.querySelector('#pp-import-confirm');
  if(!db||!ppImportRowsPending.length)return toast('Nessun dato pronto da importare.');
  button.disabled=true;button.textContent='Importazione in corso…';
  const {data,error}=await db.rpc('crm_import_puprime_clienti',{p_rows:ppImportRowsPending,p_source_file:ppImportFileName});
  if(error){button.disabled=false;button.textContent='Riprova';return toast('Importazione non riuscita: '+error.message);}
  const result=data||{};ppImportRowsPending=[];ppImportFileName='';close();await loadRealData();render('puprime');
  toast('Importati '+Number(result.valid||0)+' clienti: '+Number(result.inserted||0)+' nuovi, '+Number(result.updated||0)+' aggiornati.');
}

document.addEventListener('click',e=>{
  if(e.target.closest('[data-action="pp-import"]')){e.preventDefault();document.querySelector('#pp-import-file')?.click();}
});
document.addEventListener('change',async e=>{
  if(e.target.id!=='pp-import-file')return;
  const file=e.target.files?.[0];if(!file)return;
  try{const rows=await ppReadImportFile(file);if(!rows.length)throw new Error('Nessun cliente valido trovato.');ppShowImportPreview(rows,file);}catch(err){toast('File non importabile: '+err.message);}finally{e.target.value='';}
});
