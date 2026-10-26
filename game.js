// Change these settings to tune the game.
const LEVELS = [4,6,8,10,12,15,18,20,22,25].map(pairs=>({pairs,seconds:Math.max(30,pairs*7.5)}));
const SYMBOLS = ['✦','●','▲','■','☀','☾','♥','✿','◆','✚','◎','♠','♣','♦','★','☂','♫','⚑','✈','☁','☯','☕','⚓','⌛','⚡'];
const PALETTE=['#ff5fa2','#c6f432','#ffc933','#4cc9f0','#ff8a4c','#b79cff','#5ee6b0'];
const COST = {shield:150,peek:250};
const WALLET_KEY='memory-studio-wallet-v1';
const $=id=>document.getElementById(id);
let completedStages=0;
let level=0,score=0,found=0,first=null,locked=true,running=false,finished=false;
let deadline=0,remaining=30,interval=null,pending=null,previewTimer=null,peekTimer=null;
let streak=0,shieldActive=false,peeking=false,roundPoints=0,previewing=false,previewDeadline=0;
let wallet=0;
try{const saved=Number(localStorage.getItem(WALLET_KEY));if(Number.isSafeInteger(saved)&&saved>=0)wallet=saved;}catch{}
function saveWallet(){try{localStorage.setItem(WALLET_KEY,String(wallet));}catch{}}
function renderJourney(){
  $('journeyTitle').textContent=completedStages===LEVELS.length?'Your journey · All levels cleared':'Your journey · Level '+(level+1)+' / '+LEVELS.length;
  $('journeyCount').textContent=completedStages+' cleared · '+(LEVELS.length-completedStages)+' remaining';
  $('levelTrack').replaceChildren();
  LEVELS.forEach((stage,index)=>{
    const step=document.createElement('li');const done=index<completedStages,current=index===level&&!done;
    step.className='level-step'+(done?' done':current?' current':'');
    step.textContent=done?'✓ '+(index+1):String(index+1).padStart(2,'0');
    step.setAttribute('aria-label','Level '+(index+1)+': '+(done?'cleared':current?'current':'ahead')+'; '+stage.pairs*2+' cards');
    if(current)step.setAttribute('aria-current','step');$('levelTrack').append(step);
  });
}

// Replace files in audio/ to change music and sound effects.
const AudioEngine=(()=>{
  const music=$('backgroundMusic');music.volume=.3; // Background volume: 0 to 1.
  let ctx=null,sfxBus=null,playPending=false,interacted=false;
  let musicOn=true,sfxOn=true;
  try{musicOn=localStorage.getItem('memory-music')!=='off';sfxOn=localStorage.getItem('memory-sfx')!=='off';}catch{}
  function ui(){
    $('musicToggle').textContent='♫ Music: '+(musicOn?'on':'off');$('musicToggle').setAttribute('aria-pressed',String(musicOn));
    $('sfxToggle').textContent='✦ SFX: '+(sfxOn?'on':'off');$('sfxToggle').setAttribute('aria-pressed',String(sfxOn));
    $('audioHint').textContent=interacted?'MP3 background loop · Victory chime':'Sound starts with your first click or key press.';
  }
  function syncMusic(){
    if(!musicOn||document.hidden){music.pause();return;}
    if(!interacted||!music.paused||playPending)return;
    playPending=true;
    music.play().then(()=>{if(!musicOn||document.hidden)music.pause();}).catch(error=>{
      if(error.name!=='AbortError')$('audioHint').textContent='Click Music to enable background audio.';
    }).finally(()=>{playPending=false;});
  }
  function note(midi,when,duration,volume,bus,type='sine'){
    const oscillator=ctx.createOscillator(),envelope=ctx.createGain();
    oscillator.type=type;oscillator.frequency.value=440*Math.pow(2,(midi-69)/12);
    envelope.gain.setValueAtTime(0,when);envelope.gain.linearRampToValueAtTime(volume,when+.04);
    envelope.gain.exponentialRampToValueAtTime(.0001,when+duration);
    oscillator.connect(envelope);envelope.connect(bus);oscillator.start(when);oscillator.stop(when+duration+.03);
    oscillator.onended=()=>{oscillator.disconnect();envelope.disconnect();};
  }
  function unlock(){
    interacted=true;ui();syncMusic();
    try{
      if(!ctx){const Constructor=window.AudioContext||window.webkitAudioContext;
        if(!Constructor)return;
        ctx=new Constructor();sfxBus=ctx.createGain();sfxBus.connect(ctx.destination);sfxBus.gain.value=sfxOn?.65:0;
      }
      if(ctx.state==='suspended')void ctx.resume().catch(()=>{});
    }catch{} // MP3 playback still works if synthesized SFX is unavailable.
  }
  function toggle(kind){
    if(kind==='music')musicOn=!musicOn;
    else{sfxOn=!sfxOn;if(sfxBus)sfxBus.gain.value=sfxOn?.65:0;if(!sfxOn){$('loseSfx').pause();$('winSfx').pause();}}
    try{localStorage.setItem('memory-'+kind,(kind==='music'?musicOn:sfxOn)?'on':'off');}catch{}
    unlock();
  }
  function flipSfx(){
    if(!sfxOn||!interacted||document.hidden)return;
    const sound=$('flipSfx');
    try{sound.currentTime=0;sound.volume=.65;sound.play().catch(()=>{});}catch{}
  }
  function lose(){
    if(!sfxOn||!interacted||document.hidden)return;
    const l=$('loseSfx');try{l.currentTime=0;l.volume=.85;l.play().catch(()=>{});}catch{}
  }
  function victory(){
    if(!sfxOn||!interacted||document.hidden)return;
    const w=$('winSfx');try{w.currentTime=0;w.volume=.9;w.play().catch(()=>{});}catch{}
  }
  document.addEventListener('click',event=>{if(!event.target.closest('.audio-toggle'))unlock();});
  document.addEventListener('keydown',event=>{if(!event.target.closest('.audio-toggle'))unlock();});
  document.addEventListener('visibilitychange',()=>{
    if(document.hidden){music.pause();if(ctx)void ctx.suspend().catch(()=>{});}
    else if(interacted)unlock();
  });
  music.addEventListener('error',()=>{$('audioHint').textContent='Background audio could not load.';});
  $('musicToggle').addEventListener('click',()=>toggle('music'));
  $('sfxToggle').addEventListener('click',()=>toggle('sfx'));
  ui();return {victory,lose,flip:flipSfx};
})();
function previewSeconds(cardCount){return Math.max(2,Math.ceil(cardCount/10));}
function shuffle(items){for(let i=items.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[items[i],items[j]]=[items[j],items[i]];}return items;}
function cards(){return [...$('board').children];}
function stopTimers(){
  clearInterval(interval);clearTimeout(pending);clearInterval(previewTimer);clearTimeout(peekTimer);
  interval=pending=previewTimer=peekTimer=null;
}
function labelCard(card){
  const exposed=['flipped','preview','peek','matched'].some(name=>card.classList.contains(name));
  card.setAttribute('aria-label','Card '+card.dataset.number+(exposed?': '+card.dataset.symbol:', face down')+(card.classList.contains('matched')?', matched':''));
}
function shopReady(){return running&&!finished&&!locked&&!first&&!peeking;}
function updateStats(){
  $('level').textContent=String(level+1).padStart(2,'0');
  $('score').textContent=String(score).padStart(3,'0');$('time').textContent=Math.ceil(remaining)+'s';
  $('progress').textContent=found+' / '+LEVELS[level].pairs+' pairs found';
  $('timerFill').style.width=Math.min(100,remaining/LEVELS[level].seconds*100)+'%';
  $('timerFill').style.background=remaining<=10?'var(--accent)':'var(--green)';
  $('streak').textContent='Streak: '+streak+(shieldActive?' · Shield on':'');
  $('wallet').textContent=wallet;
  $('shield').disabled=!shopReady()||shieldActive||wallet<COST.shield;
  $('peek').disabled=!shopReady()||wallet<COST.peek;
}

// Choose a grid that keeps every card inside the available board area.
function fitBoard(){
 const board=$('board'),count=board.children.length;
 if(!count)return;
 const w=board.clientWidth-10,h=board.clientHeight-10,gap=8;
 let best=null;
 for(let cols=2;cols<=Math.min(12,count);cols++){
  const rows=Math.ceil(count/cols);
  const cw=(w-gap*(cols-1))/cols,ch=(h-gap*(rows-1))/rows;
  const size=Math.min(cw,ch*.94,140);
  const score=size-(cols*rows-count)*.12;
  if(!best||score>best.score)best={cols,rows,size,score};
 }
 if(!best||best.size<=0)return;
 board.style.gridTemplateColumns=`repeat(${best.cols}, ${Math.floor(best.size)}px)`;
 board.style.gridTemplateRows=`repeat(${best.rows}, ${Math.floor(best.size/.94)}px)`;
 board.style.setProperty('--symbol-size',Math.max(16,Math.min(44,best.size*.43))+'px');
}
new ResizeObserver(fitBoard).observe($('board'));

function startLevel(){
  stopTimers();if($('result').open)$('result').close();
  {['loseSfx','winSfx'].forEach(id=>{const a=$(id);a.pause();a.currentTime=0;});}
  first=null;locked=true;running=false;finished=false;found=0;streak=0;
  shieldActive=false;peeking=false;roundPoints=0;previewing=true;remaining=LEVELS[level].seconds;
  $('board').replaceChildren();$('board').classList.toggle('dense',LEVELS[level].pairs>12);
  const symbols=shuffle([...SYMBOLS]).slice(0,LEVELS[level].pairs);
  shuffle([...symbols,...symbols]).forEach((symbol,index)=>{
    const card=document.createElement('button');card.className='card preview';card.type='button';
    card.dataset.symbol=symbol;card.style.setProperty('--c',PALETTE[SYMBOLS.indexOf(symbol)%PALETTE.length]);card.dataset.number=index+1;labelCard(card);
    card.innerHTML='<span class="card-inner"><span class="face back" aria-hidden="true"><span>✳</span></span><span class="face front" aria-hidden="true">'+symbol+'</span></span>';
    card.addEventListener('click',()=>flip(card));$('board').append(card);
  });
  renderJourney();
  fitBoard();
  const seconds=previewSeconds(LEVELS[level].pairs*2);
  $('status').textContent='Memorize all the cards. Your round timer starts after this '+seconds+'s preview.';
  previewDeadline=Date.now()+seconds*1000;
  updatePreview();previewTimer=setInterval(updatePreview,100);updateStats();
}
function updatePreview(){
  if(!previewing)return;
  const left=Math.max(0,Math.ceil((previewDeadline-Date.now())/1000));
  $('phase').textContent='Memorize · '+left+'s';
  if(left===0)beginRound();
}
function beginRound(){
  clearInterval(previewTimer);previewTimer=null;previewing=false;
  cards().forEach(c=>{c.classList.remove('preview');labelCard(c);});
  locked=false;running=true;deadline=Date.now()+remaining*1000;
  $('phase').textContent='Find the pairs';$('status').textContent='Two consecutive matches = +3s. A mismatch = −2s.';
  interval=setInterval(tick,100);updateStats();
}
function tick(){
  if(!running||finished)return;
  remaining=Math.max(0,Math.ceil((deadline-Date.now())/1000));updateStats();
  if(remaining===0)finish(false);
}
function flip(card){
  if(!running||finished||locked||peeking||card.classList.contains('flipped')||card.classList.contains('matched'))return;
  tick();if(finished)return;
  card.classList.add('flipped');labelCard(card);AudioEngine.flip();
  if(!first){first=card;$('status').textContent='Find its matching symbol.';updateStats();return;}
  const previous=first;first=null;locked=true;
  if(previous.dataset.symbol===card.dataset.symbol){
    [previous,card].forEach(c=>{c.classList.add('matched');c.disabled=true;labelCard(c);});
    found++;score+=10;roundPoints+=10;streak++;locked=false;
    // Reward each pair of consecutive matches: streak 2, 4, 6, etc.
    const bonus=streak%2===0;
    if(bonus)deadline+=3000;
    $('status').textContent=bonus?'Two more in a row! +3 seconds.':'Perfect pair! +10 stage points.';
    tick();
    if(found===LEVELS[level].pairs&&!finished){const bonusPoints=Math.floor(remaining/5);score+=bonusPoints;roundPoints+=bonusPoints;finish(true);}
  }else{
    streak=0;
    if(shieldActive){shieldActive=false;$('status').textContent='Shield used. No time penalty for this mismatch.';}
    else{deadline-=2000;$('status').textContent='Not a match. −2 seconds. Streak reset.';}
    tick();if(finished)return;
    pending=setTimeout(()=>{
      [previous,card].forEach(c=>{c.classList.remove('flipped');labelCard(c);});
      locked=false;pending=null;updateStats();
    },850);
  }
  updateStats();
}
function buyShield(){
  if(!shopReady()||shieldActive||wallet<COST.shield)return;
  tick();if(finished)return;
  wallet-=COST.shield;shieldActive=true;saveWallet();updateStats();
  $('status').textContent='Shield ready. Your next mismatch will not cost time.';
}
function buyPeek(){
  if(!shopReady()||wallet<COST.peek)return;
  tick();if(finished)return;
  const groups={};
  cards().filter(c=>!c.classList.contains('matched')).forEach(c=>{(groups[c.dataset.symbol]=groups[c.dataset.symbol]||[]).push(c);});
  const chosen=shuffle(Object.values(groups).filter(g=>g.length>=2)).slice(0,2).flatMap(g=>g.slice(0,2));
  if(!chosen.length)return;
  wallet-=COST.peek;saveWallet();peeking=true;locked=true;
  chosen.forEach(c=>{c.classList.add('peek');labelCard(c);});updateStats();
  $('status').textContent='Look! These are '+chosen.length/2+' matching pair'+(chosen.length>2?'s':'')+'. Remember where they are. The timer keeps running.';
  peekTimer=setTimeout(()=>{
    chosen.forEach(c=>{c.classList.remove('peek');labelCard(c);});
    peeking=false;locked=false;peekTimer=null;updateStats();
    $('status').textContent='Now use what you remember to find the pairs.';
  },2000);
}
function finish(won){
  if(finished)return;
  stopTimers();finished=true;running=false;previewing=false;locked=true;peeking=false;
  cards().forEach(c=>{c.classList.remove('peek');labelCard(c);});
  if(won){wallet+=roundPoints;saveWallet();completedStages=level+1;renderJourney();AudioEngine.victory();}else{AudioEngine.lose();}
  updateStats();const complete=won&&level===LEVELS.length-1;
  $('resultTitle').textContent=complete?'Beautifully focused.':won?'Nice work.':'Try this level again.';
  $('resultText').textContent=won?'Level '+(level+1)+' cleared! +'+roundPoints+' points added to your wallet (including time bonus). '+(complete?'You completed all 10 levels!':'Spend them on help in the next stage.'):'Time ran out. You found '+found+' of '+LEVELS[level].pairs+' pairs. Your previously banked points are safe; this unfinished stage earns no wallet points. Retry level '+(level+1)+' with a fresh board and full time.';
  $('continue').textContent=!won?'Retry level '+(level+1)+' ↻':!complete?'Next level →':'Play again ↗';
  $('continue').onclick=()=>{if(won&&!complete)level++;else if(complete){level=0;score=0;completedStages=0;}else{score=Math.max(0,score-roundPoints);}startLevel();$('board').firstElementChild.focus();};
  $('phase').textContent=won?'Stage cleared':'Round over';$('status').textContent=won?'Points banked. Wallet: '+wallet+'.':'Time is up.';
  $('result').showModal();
}
$('shield').addEventListener('click',buyShield);$('peek').addEventListener('click',buyPeek);
$('result').addEventListener('cancel',e=>e.preventDefault());
$('restart').addEventListener('click',()=>{level=0;score=0;completedStages=0;startLevel();});
startLevel();
