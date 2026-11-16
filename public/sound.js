'use strict';
// Original, lightweight Web Audio effects. Audio is created only after user interaction.
window.BattleSound=(()=>{
  let context=null;
  const key='battleship.sound.enabled';
  let enabled=localStorage.getItem(key)!=='false';
  function setup() {
    if(!enabled)return null;
    try {
      context ??= new (window.AudioContext||window.webkitAudioContext)();
      if(context.state==='suspended')context.resume().catch(()=>{});
      return context;
    }catch{return null;}
  }
  function tone(freq,duration,type='sine',volume=.065,delay=0,to=null) {
    const ctx=setup();if(!ctx)return;
    const start=ctx.currentTime+delay,osc=ctx.createOscillator(),gain=ctx.createGain();
    osc.type=type;osc.frequency.setValueAtTime(Math.max(20,freq),start);
    if(to)osc.frequency.exponentialRampToValueAtTime(Math.max(20,to),start+duration);
    gain.gain.setValueAtTime(.0001,start);
    gain.gain.exponentialRampToValueAtTime(volume,start+.012);
    gain.gain.exponentialRampToValueAtTime(.0001,start+duration);
    osc.connect(gain);gain.connect(ctx.destination);osc.start(start);osc.stop(start+duration+.02);
  }
  function noise(duration=.13,volume=.04,delay=0) {
    const ctx=setup();if(!ctx)return;
    const len=Math.ceil(ctx.sampleRate*duration);
    const buffer=ctx.createBuffer(1,len,ctx.sampleRate),data=buffer.getChannelData(0);
    for(let i=0;i<len;i++)data[i]=(Math.random()*2-1)*(1-i/len);
    const source=ctx.createBufferSource(),gain=ctx.createGain(),filter=ctx.createBiquadFilter();
    source.buffer=buffer;filter.type='lowpass';filter.frequency.value=1100;
    gain.gain.value=volume;source.connect(filter);filter.connect(gain);gain.connect(ctx.destination);
    source.start(ctx.currentTime+delay);
  }
  const effects={
    fire(){tone(280,.16,'sawtooth',.045,0,88);noise(.12,.028,0);},
    miss(){tone(510,.12,'sine',.05);tone(380,.2,'sine',.04,.14);},
    hit(){tone(180,.24,'square',.06,0,62);noise(.24,.08,.025);},
    sunk(){tone(350,.24,'triangle',.07);tone(260,.24,'triangle',.07,.17);tone(170,.45,'sawtooth',.05,.38,65);},
    victory(){[392,493,587,784].forEach((f,i)=>tone(f,.26,'triangle',.06,i*.16));},
    defeat(){[440,350,262,190].forEach((f,i)=>tone(f,.3,'triangle',.055,i*.2));}
  };
  return {
    get enabled(){return enabled;},
    setEnabled(value){enabled=!!value;localStorage.setItem(key,String(enabled));if(enabled)setup();},
    unlock(){setup();},
    play(name){if(enabled)effects[name]?.();}
  };
})();