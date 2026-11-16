'use strict';
const $ = id => document.getElementById(id);
let me=null, current=null, busy=false;
const esc = text => String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(action, data=null, query='') {
  const opts=data===null?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(data)};
  const res=await fetch('api.php?action='+encodeURIComponent(action)+query,opts);
  let obj;
  try { obj=await res.json(); } catch { throw Error('Server returned a non-JSON response. Check PHP logs.'); }
  if(!res.ok) throw Error(obj.error||'Request failed');
  return obj;
}
function notice(msg='') { $('notice').hidden=!msg; $('notice').textContent=msg; }
function section(name) {
  for (const id of ['select-panel','lobby','battle']) $(id).hidden=id!==name;
}
async function loadPlayers() {
  const data=await api('players');
  $('known-players').innerHTML=data.players.map(p=>'<option value="'+esc(p.name)+'">').join('');
  me=data.players.find(p=>Number(p.id)===Number(data.selected))||null;
  $('identity').textContent=me?me.name.toUpperCase():'NO COMMANDER';
  if(!me){current=null;section('select-panel');}
  else if(current) await loadGame();
  else await loadLobby();
}
async function loadLobby() {
  if(!me)return;
  const data=await api('lobby');
  const open=data.games.filter(g=>g.status==='waiting');
  $('game-count').textContent=data.games.length+' listed';
  $('games').innerHTML=data.games.length ? data.games.map(g=>{
    const own=Number(g.host_id)===Number(me.id)||Number(g.guest_id)===Number(me.id);
    const canJoin=g.status==='waiting'&&!own;
    const button=own?'Resume':canJoin?'Join':'Unavailable';
    return '<div class="game"><div><strong>'+esc(g.name)+'</strong><small>'+
      esc(g.host_name)+' vs '+esc(g.guest_name||'Awaiting opponent')+' · '+esc(g.size)+'×'+esc(g.size)+' · '+esc(g.status)+
      '</small></div><button data-id="'+g.id+'" data-action="'+(own?'open':canJoin?'join':'none')+'" '+(!own&&!canJoin?'disabled':'')+'>'+button+'</button></div>';
  }).join(''):'<p class="muted">No operations yet. Create the first one.</p>';
  const stats=await api('stats');
  $('stats').innerHTML='<table><thead><tr><th>Player</th><th>Completed</th><th>Wins</th></tr></thead><tbody>'+
    stats.players.map(p=>'<tr><td>'+esc(p.name)+'</td><td>'+Number(p.played||0)+'</td><td>'+Number(p.wins||0)+'</td></tr>').join('')+'</tbody></table>';
  section('lobby');
}
async function loadGame() {
  if(!current||!me)return;
  const response=await api('game',null,'&id='+current);
  drawGame(response.game);
}
function makeBoard(node,g,isEnemy) {
  node.style.setProperty('--size',g.size);
  node.replaceChildren();
  const shots=isEnemy?g.target_shots:g.own_shots;
  const shotMap=new Map(shots.map(s=>[s.x+','+s.y,s.result]));
  const fleet=isEnemy?g.enemy_fleet:g.fleet;
  const occupied=new Set((fleet||[]).flat().map(c=>c[0]+','+c[1]));
  const corner=document.createElement('div');corner.className='axis';node.append(corner);
  for(let x=0;x<g.size;x++){const axis=document.createElement('div');axis.className='axis';axis.textContent=String.fromCharCode(65+x);node.append(axis);}
  for(let y=0;y<g.size;y++){
    const axis=document.createElement('div');axis.className='axis';axis.textContent=y+1;node.append(axis);
    for(let x=0;x<g.size;x++){
      const k=x+','+y,shot=shotMap.get(k);
      const cell=document.createElement('button');cell.type='button';
      const canFire=isEnemy&&g.status==='active'&&Number(g.turn_id)===Number(me.id)&&!shot;
      cell.className='cell'+(occupied.has(k)?' ship':'')+(shot?' '+(shot==='sunk'?'sunk':shot):'')+(canFire?' target':'');
      cell.textContent=shot?(shot==='miss'?'·':'✕'):'';
      cell.title=String.fromCharCode(65+x)+(y+1)+(shot?' — '+shot:'');
      cell.setAttribute('aria-label',cell.title);cell.disabled=!canFire;
      if(canFire) cell.addEventListener('click',()=>fire(g.id,x,y));
      node.append(cell);
    }
  }
}
function drawGame(g) {
  $('battle-title').textContent=g.name;
  $('operation-subtitle').textContent='OPERATION '+g.id+' · '+g.size+'×'+g.size;
  const yourTurn=g.status==='active'&&Number(g.turn_id)===Number(me.id);
  const desc=g.status==='waiting'?'Awaiting another human commander to join. You can prepare your fleet now.':
    g.status==='deployment'?(g.ready?'Fleet locked. Waiting for the opponent.':'Deploy your fleet and select Ready.'):
    g.status==='finished'?(Number(g.winner_id)===Number(me.id)?'VICTORY — Enemy fleet destroyed.':'DEFEAT — Your fleet was destroyed.'):
    (yourTurn?'YOUR TURN — Select a target in enemy waters.':'OPPONENT TURN — Awaiting incoming fire.');
  $('battle-status').textContent=desc;
  $('deployment').hidden=!['waiting','deployment'].includes(g.status);
  $('randomize').disabled=Boolean(g.ready);
  $('ready').disabled=Boolean(g.ready);
  $('ready').textContent=g.ready?'Fleet Ready ✓':'Ready — Lock Fleet';
  makeBoard($('enemy-board'),g,true);
  makeBoard($('own-board'),g,false);
  const hits=g.target_shots.filter(s=>s.result!=='miss').length;
  $('telemetry').textContent='Shots fired: '+g.target_shots.length+' · Confirmed hits: '+hits+' · Enemy shots received: '+g.own_shots.length+
    (g.status==='finished'?' · Operation complete':'');
  section('battle');
}
async function fire(id,x,y) {
  if(busy||!confirm('Fire at '+String.fromCharCode(65+x)+(y+1)+'?'))return;
  busy=true;
  try {notice();const r=await api('fire',{id,x,y});drawGame(r.game);}
  catch(e){notice(e.message);await loadGame();}
  finally{busy=false;}
}
async function postGame(action) {
  if(!current||busy)return;busy=true;
  try {notice();const r=await api(action,{id:current});drawGame(r.game);}
  catch(e){notice(e.message);}finally{busy=false;}
}
$('player-form').addEventListener('submit',async e=>{
  e.preventDefault();try{notice();await api('select',{name:$('player-name').value});current=null;await loadPlayers();}catch(err){notice(err.message);}
});
$('change-player').addEventListener('click',()=>{current=null;me=null;$('identity').textContent='NO COMMANDER';section('select-panel');});
$('create-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    notice();const r=await api('create',{name:$('operation-name').value,size:Number($('board-size').value)});
    current=r.id;await loadGame();
  }catch(err){notice(err.message);}
});
$('games').addEventListener('click',async e=>{
  const btn=e.target.closest('button[data-id]');if(!btn||btn.disabled)return;
  const id=Number(btn.dataset.id);try{notice();
    if(btn.dataset.action==='join')await api('join',{id});
    current=id;await loadGame();
  }catch(err){notice(err.message);}
});
$('refresh').addEventListener('click',()=>loadLobby().catch(e=>notice(e.message)));
$('back').addEventListener('click',()=>{current=null;loadLobby().catch(e=>notice(e.message));});
$('randomize').addEventListener('click',()=>postGame('randomize'));
$('ready').addEventListener('click',()=>postGame('ready'));
setInterval(()=>{if(document.visibilityState!=='visible'||busy||!me)return;
  (current?loadGame():loadLobby()).catch(e=>notice(e.message));
},2500);
loadPlayers().catch(e=>notice(e.message));
