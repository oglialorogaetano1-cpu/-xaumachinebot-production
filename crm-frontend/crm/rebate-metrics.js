/* Pure presentation helpers: no zero defaults for missing broker reports. */
(function(root){
  const IBS=['7527073','23217421'];
  const day=(now=new Date())=>new Intl.DateTimeFormat('en-CA',{timeZone:'Europe/Rome',year:'numeric',month:'2-digit',day:'2-digit'}).format(now);
  const money=value=>value===null||value===undefined||value===''||!Number.isFinite(Number(value))?'—':Number(value).toLocaleString('it-IT',{style:'currency',currency:'USD',minimumFractionDigits:2,maximumFractionDigits:2});
  const stamp=value=>value?new Date(value).toLocaleString('it-IT',{timeZone:'Europe/Rome',day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'}):'non disponibile';
  function view(summary,now=new Date()){
    const expected=day(now),valid=summary&&summary.day===expected;
    const rows=IBS.map(ib=>{
      const r=(summary?.ibs||[]).find(x=>x.affiliate_id===ib)||{};
      return {ib,daily:valid?r.daily:null,monthly:valid?r.monthly:null,balance:r.available_balance,
        earningsUpdated:stamp(r.earnings_updated_at),balanceUpdated:stamp(r.balance_updated_at)};
    });
    return {day:expected,daily:valid?summary.daily:null,monthly:valid?summary.monthly:null,
      balance:summary?.available_balance,rows};
  }
  function render(summary,esc,now=new Date()){
    const m=view(summary,now);
    const cards=[['Rebate maturati oggi',m.daily,'Data '+m.day+' · Europe/Rome'],
      ['Rebate maturati nel mese',m.monthly,'Dal primo del mese a oggi'],
      ['Saldo rebate disponibile',m.balance,'Saldo attuale prelevabile · separato dalle commissioni']];
    return '<section class="kpi-grid kpi-operational rebate-metrics">'+cards.map(([label,value,note])=>
      '<article class="kpi"><b>'+money(value)+'</b><span>'+esc(label)+'</span><small>'+esc(value==null?'Report PuPrime non disponibile':note)+'</small></article>').join('')+
      '</section><section class="card rebate-ib-details"><h3>Dettaglio rebate per IB</h3><div class="table-wrap"><table><thead><tr><th>IB</th><th>Maturati oggi</th><th>Maturati nel mese</th><th>Saldo disponibile</th><th>Aggiornamento</th></tr></thead><tbody>'+m.rows.map(r=>
      '<tr><td>'+r.ib+'</td><td>'+money(r.daily)+'</td><td>'+money(r.monthly)+'</td><td>'+money(r.balance)+'</td><td><small>Commissioni: '+esc(r.earningsUpdated)+'<br>Saldo: '+esc(r.balanceUpdated)+'</small></td></tr>').join('')+
      '</tbody></table></div><p class="muted">Le commissioni appartengono alla data del report; le modifiche ai contatti non cambiano i rebate. “—” indica un dato non ancora verificato. Valori in USD.</p></section>';
  }
  const api={day,money,view,render};if(typeof module!=='undefined'&&module.exports)module.exports=api;else root.PuPrimeRebateMetrics=api;
})(typeof window!=='undefined'?window:this);
