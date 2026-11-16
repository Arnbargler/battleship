'use strict';
const $ = id => document.getElementById(id);
let me=null, current=null, busy=false, viewSerial=0, lastApplied=0, polling=false;
const savedPlayerKey='battleship.player.id';
let tabPlayerId=Number(sessionStorage.getItem(savedPlayerKey))||null;
let drag=null, shownGame=null, audioGameId=null, lastAudioShotId=0, lastOutcome=null;
const esc = text => String(text??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
async function api(action, data=null, query='') {
  const headers=tabPlayerId?{'X-Battleship-Player':String(tabPlayerId)}:{};
  const opts=data===null?{cache:'no-store',headers}:{method:'POST',cache:'no-store',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(data)};
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
  // A tab has its own identity; PHP cookies are shared across tabs and may switch under us.
  me=data.players.find(p=>Number(p.id)===Number(tabPlayerId))||null;
  if(tabPlayerId&&!me){tabPlayerId=null;sessionStorage.removeItem(savedPlayerKey);}
  $('identity').textContent=me?me.name.toUpperCase():'NO COMMANDER';
  if(!me){current=null;section('select-panel');}
  else if(current) await loadGame();
  else await loadLobby();
}
async function loadLobby() {
  if(!me)return;
  const data=await api('lobby');
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
  if(!current||!me||busy||drag)return;
  const wanted=current, serial=++viewSerial;
  const response=await api('game',null,'&id='+wanted);
  if(current!==wanted || serial<lastApplied || busy || drag)return;
  lastApplied=serial;
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
      const canFire=isEnemy&&g.status==='active'&&Number(g.turn_id)===Number(g.you)&&!shot;
      cell.className='cell'+(occupied.has(k)?' ship':'')+(shot?' '+(shot==='sunk'?'sunk':shot):'')+(canFire?' target':'');
      cell.textContent=shot?(shot==='miss'?'•':'✕'):'';
      cell.title=String.fromCharCode(65+x)+(y+1)+(shot?' — '+shot:'');
      cell.setAttribute('aria-label',cell.title);
      cell.dataset.x=x;cell.dataset.y=y;
      cell.disabled=!canFire && !( !isEnemy && ['waiting','deployment'].includes(g.status) && !g.ready && occupied.has(k));
      if(canFire) cell.addEventListener('click',()=>fire(g.id,x,y));
      node.append(cell);
    }
  }
}
function drawGame(g) {
  const shotTimeline=[...g.target_shots.map(s=>({...s,side:'outgoing'})),...g.own_shots.map(s=>({...s,side:'incoming'}))].sort((a,b)=>a.id-b.id);
  // First render is silent; subsequent server-confirmed events produce cues once.
  if(audioGameId!==g.id) {
    audioGameId=g.id;
    lastAudioShotId=shotTimeline.at(-1)?.id||0;
    lastOutcome=g.status==='finished'?g.winner_id:null;
  } else {
    const events=shotTimeline.filter(s=>s.id>lastAudioShotId);
    const recent=events.at(-1);
    if(recent && document.visibilityState==='visible') BattleSound.play(recent.result==='sunk'?'sunk':recent.result==='hit'?'hit':'miss');
    lastAudioShotId=Math.max(lastAudioShotId,shotTimeline.at(-1)?.id||0);
    if(g.status==='finished'&&lastOutcome===null&&document.visibilityState==='visible')
      BattleSound.play(Number(g.winner_id)===Number(g.you)?'victory':'defeat');
    lastOutcome=g.status==='finished'?g.winner_id:null;
  }
  shownGame=g;
  $('battle-title').textContent=g.name;
  $('operation-subtitle').textContent='OPERATION '+g.id+' · '+g.size+'×'+g.size;
  const yourTurn=g.status==='active'&&Number(g.turn_id)===Number(g.you);
  const sessionMatch=Number(g.you)===Number(me.id);
  const desc=g.status==='waiting'?'Awaiting another human commander to join. You can prepare your fleet now.':
    g.status==='deployment'?(g.ready?'Fleet locked. Waiting for the opponent.':(g.ai_level?'Place your fleet, then click Ready to face AI '+g.ai_level+'.':'Deploy your fleet and select Ready.')):
    g.status==='finished'?(Number(g.winner_id)===Number(me.id)?'VICTORY — Enemy fleet destroyed.':'DEFEAT — Your fleet was destroyed.'):
    (yourTurn?'YOUR TURN — Select a target in enemy waters.':'OPPONENT TURN — Awaiting incoming fire.');
  const phase=g.status==='finished'?'finished':g.status==='active'?(yourTurn?'your':'enemy'):'setup';
  $('battle').dataset.phase=phase;
  $('command-state').textContent=g.status==='finished'?'MISSION COMPLETE':g.status==='active'?'TACTICAL LINK ACTIVE':'DEPLOYMENT CHANNEL';
  $('combat-phase').textContent=g.status==='finished'?'FINAL REPORT':yourTurn?'WEAPONS READY':g.status==='active'?'AWAITING OPPONENT':'STANDBY';
  $('battle-status').textContent=desc;
  if(!sessionMatch) notice('Player identity mismatch. Use Change Player and select your commander again.');
  $('deployment').hidden=!['waiting','deployment'].includes(g.status);
  $('placement-hint').hidden=g.ready || !['waiting','deployment'].includes(g.status);
  $('randomize').disabled=Boolean(g.ready);
  $('ready').disabled=Boolean(g.ready);
  $('ready').textContent=g.ready?'Fleet Ready ✓':'Ready — Lock Fleet';
  makeBoard($('enemy-board'),g,true);
  makeBoard($('own-board'),g,false);
  const hits=g.target_shots.filter(s=>s.result!=='miss').length;
  $('metric-shots').textContent=g.target_shots.length;
  $('metric-hits').textContent=hits;
  $('metric-accuracy').textContent=g.target_shots.length?(100*hits/g.target_shots.length).toFixed(1)+'%':'0%';
  $('metric-incoming').textContent=g.own_shots.length;
  $('combat-log').innerHTML=shotTimeline.length?shotTimeline.slice(-12).reverse().map(s=>{
    const coord=String.fromCharCode(65+s.x)+(s.y+1);
    const actor=s.side==='outgoing'?'YOU':'ENEMY';
    const outcome=s.result.toUpperCase();
    return '<div class="log-entry '+esc(s.result)+'"><span><strong>'+actor+' · '+outcome+'</strong></span><span class="coord">'+coord+'</span></div>';
  }).join(''):'<div class="log-entry">No shots fired yet.</div>';
  $('telemetry').textContent='Shots fired: '+g.target_shots.length+' · Confirmed hits: '+hits+' · Enemy shots received: '+g.own_shots.length+
    (g.status==='finished'?' · Operation complete':'');
  section('battle');
}
async function fire(id,x,y) {
  if(busy||!confirm('Fire at '+String.fromCharCode(65+x)+(y+1)+'?'))return;
  busy=true;
  BattleSound.unlock();BattleSound.play('fire');
  try {notice();const r=await api('fire',{id,x,y});lastApplied=++viewSerial;drawGame(r.game);}
  catch(e){notice(e.message);await loadGame();}
  finally{busy=false;}
}
async function postGame(action) {
  if(!current||busy)return;busy=true;
  try {notice();const r=await api(action,{id:current});lastApplied=++viewSerial;drawGame(r.game);}
  catch(e){notice(e.message);}finally{busy=false;}
}
$('player-form').addEventListener('submit',async e=>{
  e.preventDefault();try{notice();const result=await api('select',{name:$('player-name').value});
    tabPlayerId=Number(result.player.id);sessionStorage.setItem(savedPlayerKey,String(tabPlayerId));
    current=null;await loadPlayers();}catch(err){notice(err.message);}
});
$('change-player').addEventListener('click',()=>{current=null;me=null;tabPlayerId=null;sessionStorage.removeItem(savedPlayerKey);$('identity').textContent='NO COMMANDER';section('select-panel');});
$('opponent').addEventListener('change',()=>{$('ai-selector').hidden=$('opponent').value!=='ai';});
$('create-form').addEventListener('submit',async e=>{
  e.preventDefault();try{
    notice();const r=await api('create',{name:$('operation-name').value,size:Number($('board-size').value),ai_level:$('opponent').value==='ai'?Number($('ai-level').value):0});
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
function updateSoundButton() { const on=BattleSound.enabled; $('sound-toggle').textContent=on?'🔊 SOUND ON':'🔇 SOUND OFF'; $('sound-toggle').setAttribute('aria-pressed',String(on)); }
$('sound-toggle').addEventListener('click',()=>{BattleSound.setEnabled(!BattleSound.enabled);updateSoundButton();if(BattleSound.enabled)BattleSound.play('miss');});
updateSoundButton();
document.addEventListener('pointerdown',()=>BattleSound.unlock(),{once:true});
setInterval(async()=>{
  if(document.visibilityState!=='visible'||busy||polling||!me||drag)return;
  polling=true;
  try {if(current)await loadGame();else await loadLobby();}
  catch(e){notice(e.message);}
  finally{polling=false;}
},2500);

// Fleet deployment: drag one vessel, press Space to rotate, release to save.
// We use pointer coordinates rather than HTML drag/drop so mouse and touch work alike.
function canDeploy() {
  return shownGame && current===shownGame.id && !shownGame.ready &&
    ['waiting','deployment'].includes(shownGame.status) && !busy;
}
function shipAt(fleet,x,y) {
  return fleet.findIndex(ship=>ship.some(([sx,sy])=>sx===x&&sy===y));
}
function directionOf(ship) {return ship.length>1&&ship[0][0]===ship[1][0]?'vertical':'horizontal';}
function candidateCells(d) {
  return Array.from({length:d.length},(_,i)=>[
    d.x+(d.direction==='horizontal'?i:0),d.y+(d.direction==='vertical'?i:0)
  ]);
}
function validPlacement(d) {
  if(!shownGame)return false;
  const size=shownGame.size;
  const blocked=new Set(shownGame.fleet.flatMap((ship,index)=>index===d.index?[]:ship.map(([x,y])=>x+','+y)));
  return candidateCells(d).every(([x,y])=>x>=0&&y>=0&&x<size&&y<size&&!blocked.has(x+','+y));
}
function highlightDrag() {
  const board=$('own-board');
  board.querySelectorAll('.cell').forEach(el=>el.classList.remove('preview-valid','preview-invalid','moving-origin'));
  if(!drag)return;
  for(const [x,y] of shownGame.fleet[drag.index]){
    const el=board.querySelector('.cell[data-x="'+x+'"][data-y="'+y+'"]');
    if(el)el.classList.add('moving-origin');
  }
  const good=validPlacement(drag);
  for(const [x,y] of candidateCells(drag)) {
    const el=board.querySelector('.cell[data-x="'+x+'"][data-y="'+y+'"]');
    if(el)el.classList.add(good?'preview-valid':'preview-invalid');
  }
  $('placement-hint').textContent=(good?'VALID':'INVALID')+' · '+drag.direction.toUpperCase()+
    ' · Space to rotate · Release to '+(good?'place':'cancel');
  $('placement-hint').classList.toggle('invalid',!good);
}
function cellFromPointer(e) {
  const el=document.elementFromPoint(e.clientX,e.clientY)?.closest('#own-board .cell');
  return el?{x:Number(el.dataset.x),y:Number(el.dataset.y)}:null;
}
$('own-board').addEventListener('pointerdown',e=>{
  if(e.button!==0||!canDeploy())return;
  const cell=e.target.closest('.cell');
  if(!cell)return;
  const x=Number(cell.dataset.x),y=Number(cell.dataset.y);
  const index=shipAt(shownGame.fleet,x,y);
  if(index<0)return;
  e.preventDefault();
  const ship=shownGame.fleet[index];
  drag={index,length:ship.length,direction:directionOf(ship),
    x:ship[0][0],y:ship[0][1],offsetX:x-ship[0][0],offsetY:y-ship[0][1],
    pointerId:e.pointerId};
  $('own-board').setPointerCapture(e.pointerId);
  highlightDrag();
});
$('own-board').addEventListener('pointermove',e=>{
  if(!drag||e.pointerId!==drag.pointerId)return;
  const cell=cellFromPointer(e);
  if(!cell)return;
  drag.x=cell.x-drag.offsetX;drag.y=cell.y-drag.offsetY;
  highlightDrag();
});
function cancelDrag() {
  drag=null;
  $('placement-hint').textContent='Left-drag a ship to move it · Space to rotate during drag';
  $('placement-hint').classList.remove('invalid');
  $('own-board').querySelectorAll('.cell').forEach(el=>el.classList.remove('preview-valid','preview-invalid','moving-origin'));
}
$('own-board').addEventListener('pointercancel',cancelDrag);
$('own-board').addEventListener('lostpointercapture',()=>{if(drag)cancelDrag();});
$('own-board').addEventListener('pointerup',async e=>{
  if(!drag||e.pointerId!==drag.pointerId)return;
  const placement={...drag},id=shownGame.id;
  const valid=validPlacement(placement);
  cancelDrag();
  if(!valid){notice('Invalid placement: ship must fit and cannot overlap another vessel.');return;}
  busy=true;
  try {
    notice();
    const r=await api('place',{id,ship:placement.index,x:placement.x,y:placement.y,direction:placement.direction});
    lastApplied=++viewSerial;drawGame(r.game);
  }catch(err) {
    notice(err.message);
  }finally {busy=false;}
});
document.addEventListener('keydown',e=>{
  if(e.code!=='Space'||!drag)return;
  e.preventDefault();
  // Keep the cell under the pointer anchored while the ship rotates.
  const pivotX=drag.x+drag.offsetX,pivotY=drag.y+drag.offsetY;
  drag.direction=drag.direction==='horizontal'?'vertical':'horizontal';
  drag.offsetX=0;drag.offsetY=0;
  drag.x=pivotX;drag.y=pivotY;
  highlightDrag();
});

loadPlayers().catch(e=>notice(e.message));
