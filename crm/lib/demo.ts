export const demoLeads = [
  { id:"1", full_name:"Marco Rossi", language:"it", status:"ib_verification", first_source:"leo_italia", deposit_total:2500, rebate_total:184, puprime_status:"pending" },
  { id:"2", full_name:"Emily Carter", language:"en", status:"registration", first_source:"leotrading_en", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"3", full_name:"Luca Bianchi", language:"it", status:"active", first_source:"alice_trading", deposit_total:5200, rebate_total:426, puprime_status:"verified" },
  { id:"4", full_name:"James Wilson", language:"en", status:"conversation", first_source:"new_zealand", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"5", full_name:"Sofia Romano", language:"it", status:"registration", first_source:"leo_italia", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"6", full_name:"Oliver Brown", language:"en", status:"active", first_source:"leotrading_en", deposit_total:8000, rebate_total:612, puprime_status:"verified" },
  { id:"7", full_name:"Giulia Conti", language:"it", status:"new", first_source:"alice_trading", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"8", full_name:"Charlotte Taylor", language:"en", status:"ib_verification", first_source:"new_zealand", deposit_total:1500, rebate_total:96, puprime_status:"pending" },
  { id:"9", full_name:"Matteo Esposito", language:"it", status:"active", first_source:"leo_italia", deposit_total:12000, rebate_total:940, puprime_status:"verified" },
  { id:"10", full_name:"George Harris", language:"en", status:"conversation", first_source:"leotrading_en", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"11", full_name:"Francesca Rinaldi", language:"it", status:"conversation", first_source:"alice_trading", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"12", full_name:"Amelia Clark", language:"en", status:"active", first_source:"new_zealand", deposit_total:4300, rebate_total:338, puprime_status:"verified" },
  { id:"13", full_name:"Andrea Ferrari", language:"it", status:"registration", first_source:"leo_italia", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"14", full_name:"Harry Lewis", language:"en", status:"new", first_source:"leotrading_en", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"15", full_name:"Chiara Moretti", language:"it", status:"active", first_source:"alice_trading", deposit_total:3500, rebate_total:271, puprime_status:"verified" },
  { id:"16", full_name:"Grace Walker", language:"en", status:"ib_verification", first_source:"new_zealand", deposit_total:2000, rebate_total:124, puprime_status:"pending" },
  { id:"17", full_name:"Davide Ricci", language:"it", status:"conversation", first_source:"leo_italia", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"18", full_name:"Thomas Hall", language:"en", status:"active", first_source:"leotrading_en", deposit_total:6700, rebate_total:517, puprime_status:"verified" },
  { id:"19", full_name:"Elisa Marino", language:"it", status:"new", first_source:"alice_trading", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
  { id:"20", full_name:"Sophie Young", language:"en", status:"registration", first_source:"new_zealand", deposit_total:0, rebate_total:0, puprime_status:"not_checked" },
];

export const demoCampaigns = [
  { id:"1", name:"Leo Italia", language:"it", source_channel:"telegram", deep_link_code:"leo_it", active:true },
  { id:"2", name:"LeoTrading English", language:"en", source_channel:"telegram", deep_link_code:"leotrading_en", active:true },
  { id:"3", name:"Alice Trading", language:"it", source_channel:"telegram", deep_link_code:"alice_trading", active:true },
  { id:"4", name:"New Zealand", language:"en", source_channel:"telegram", deep_link_code:"new_zealand", active:true },
  { id:"5", name:"Spanish Trading", language:"es", source_channel:"telegram", deep_link_code:"spagnolo", active:true },
  { id:"6", name:"France Gold", language:"fr", source_channel:"telegram", deep_link_code:"francese", active:true },
  { id:"7", name:"Deutschland XAU", language:"de", source_channel:"telegram", deep_link_code:"tedesco", active:true },
  { id:"8", name:"Emirati Arabi", language:"ar", source_channel:"telegram", deep_link_code:"emirati_arabi", active:true },
  { id:"9", name:"Russian Gold", language:"ru", source_channel:"telegram", deep_link_code:"russo", active:true },
  { id:"10", name:"China Trading", language:"zh", source_channel:"telegram", deep_link_code:"cinese", active:true },
  { id:"11", name:"Norge Signals", language:"no", source_channel:"telegram", deep_link_code:"norvegese", active:true },
  { id:"12", name:"Arabic Trading", language:"ar", source_channel:"telegram", deep_link_code:"arabo", active:true },
];

export const demoConversations = [
  {id:"c1",leadId:"1",name:"Marco Rossi",language:"it",stage:"Verifica IB",time:"ora",unread:2,messages:[
    {side:"lead",text:"Ciao, ho completato la registrazione. Come faccio a sapere se il conto è corretto?",time:"10:42"},
    {side:"ai",text:"Perfetto Marco 👋 Inviami Nome e Cognome come indicati su PU Prime. Controllo il collegamento IB prima che tu faccia il deposito.",time:"10:43"},
    {side:"lead",text:"Marco Rossi. Vorrei anche capire quanto rischio con il bot.",time:"10:44"},
  ]},
  {id:"c2",leadId:"2",name:"Emily Carter",language:"en",stage:"Registration",time:"3 min",unread:1,messages:[
    {side:"lead",text:"Hi, can you explain how the trading bot works and whether profits are guaranteed?",time:"10:37"},
    {side:"ai",text:"Of course. The system operates on your own MT5 account, but trading always involves risk and profits are never guaranteed. I can show you recent real results and explain the risk settings.",time:"10:38"},
    {side:"lead",text:"Yes, please show me the weekly results.",time:"10:39"},
  ]},
  {id:"c3",leadId:"5",name:"Sofia Romano",language:"it",stage:"Registrazione",time:"8 min",unread:0,messages:[
    {side:"lead",text:"Posso iniziare con 500 euro?",time:"10:30"},
    {side:"ai",text:"Sì, puoi partire con quella cifra. Prima completiamo registrazione e verifica IB; poi ti mostro come impostare correttamente il conto Copy Popular Trading.",time:"10:31"},
  ]},
  {id:"c4",leadId:"4",name:"James Wilson",language:"en",stage:"Interested",time:"12 min",unread:0,messages:[
    {side:"lead",text:"What is the difference between the signal room and the automated bot?",time:"10:21"},
    {side:"ai",text:"The signal room lets you choose which trades to copy manually. The bot executes the strategy automatically on your account. You can try the signal room free for seven days.",time:"10:22"},
  ]},
  {id:"c5",leadId:"11",name:"Francesca Rinaldi",language:"it",stage:"Indecisa",time:"25 min",unread:1,messages:[
    {side:"lead",text:"Non sono sicura, ho già perso soldi con altri sistemi.",time:"10:05"},
    {side:"ai",text:"Capisco perfettamente la preoccupazione. Non ti prometto guadagni certi: posso mostrarti andamento reale, rischi e differenze tra bot e sala segnali, così decidi con calma.",time:"10:06"},
  ]},
  {id:"c6",leadId:"10",name:"George Harris",language:"en",stage:"Human support",time:"41 min",unread:3,messages:[
    {side:"lead",text:"I already have a PU Prime account. Can you help me change the IB?",time:"09:48"},
    {side:"ai",text:"Yes. Before you request the transfer, make sure there are no open trades, pending orders or active copy trading. I can guide you step by step.",time:"09:49"},
    {side:"lead",text:"Can someone call me about this?",time:"09:50"},
  ]},
  {id:"c7",leadId:"17",name:"Davide Ricci",language:"it",stage:"Risultati",time:"1 h",unread:0,messages:[
    {side:"lead",text:"Mi fai vedere com'è andata oggi sul conto reale?",time:"09:12"},
    {side:"ai",text:"Certo. Sto preparando lo screenshot MT5 aggiornato con saldo e risultato della giornata.",time:"09:13"},
  ]},
  {id:"c8",leadId:"20",name:"Sophie Young",language:"en",stage:"Deposit pending",time:"2 h",unread:0,messages:[
    {side:"lead",text:"My account has been verified. Should I deposit now?",time:"08:31"},
    {side:"ai",text:"Please wait for our IB confirmation first. Once the account is correctly linked, I will send the exact deposit and bot installation guide.",time:"08:32"},
  ]},
];
