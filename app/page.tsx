'use client';
import {useEffect,useRef,useState} from 'react';
import {Volume2,VolumeX,Pause,Play,RotateCcw,ArrowUpRight,CloudRain,Sun,Maximize2} from 'lucide-react';
import type {GameAPI,HUD} from './game';

const initial:HUD={speed:0,progress:0,time:0,rank:4,boost:100,rain:0,trick:'',score:0,status:'ready',suspension:[0,0],riders:[],mapPath:'',elevation:485};
const riderName=(name:string)=>({YOU:'你',ROOK:'山隼',GHOST:'流雲',JINX:'飛燕'}[name]??name);
function trickName(text:string){return text.replace('WIPED OUT','失衡 · 再起').replace('CLEAN LANDING','穩穩落地').replace('BRAKE SLIDE','側滑掠影').replace('DOUBLE ','雙重 ').replace('BACKFLIP','後空翻').replace('FRONTFLIP','前空翻').replace(' · LANDED',' · 落地').replace('AIRTIME ','凌空 ');}

export default function Home(){
 const root=useRef<HTMLDivElement>(null),api=useRef<GameAPI|null>(null);
 const [hud,setHud]=useState(initial),[loaded,setLoaded]=useState(false),[error,setError]=useState(''),[muted,setMuted]=useState(false);
 useEffect(()=>{
  let dead=false,dispose:(()=>void)|undefined;
  import('./game').then(({createGame})=>{if(dead||!root.current)return;const g=createGame(root.current,setHud);api.current=g;dispose=g.dispose;setLoaded(true);}).catch(e=>setError(String(e)));
  return()=>{dead=true;dispose?.();};
 },[]);
 const time=(s:number)=>`${Math.floor(s/60).toString().padStart(2,'0')}:${(s%60).toFixed(2).padStart(5,'0')}`;
 const active=hud.status==='racing'||hud.status==='crashed';
 return <main className={`game-shell ${active?'is-racing':''}`}>
  <div className="world" ref={root}/><div className="paper-wash"/>
  <header className="topbar">
   <div className="wordmark"><span className="seal-small">墨落</span><div>INKFALL<span>水 墨 下 坡</span></div></div>
   <div className="route-heading"><span>山 水 卷 · 第 一 回</span><strong>山巔起筆，山谷收鋒</strong></div>
   <div className="tools">
    <button aria-label={muted?'開啟音效':'靜音'} onClick={()=>{setMuted(!muted);api.current?.mute(!muted);}}>{muted?<VolumeX size={18}/>:<Volume2 size={18}/>}</button>
    <button aria-label="切換全螢幕" onClick={()=>{if(document.fullscreenElement)document.exitFullscreen().catch(()=>{});else document.documentElement.requestFullscreen?.().catch(()=>{});}}><Maximize2 size={18}/></button>
    {(active||hud.status==='paused')&&<button aria-label="暫停或繼續" onClick={()=>api.current?.pause()}>{hud.status==='paused'?<Play size={18}/>:<Pause size={18}/>}</button>}
   </div>
  </header>
  <aside className="race-meta">
   <div className="route-tag">壹 / 煙 雨 松 徑</div>
   <div className="weather">{hud.rain>.35?<CloudRain size={16}/>:<Sun size={16}/>}<span>{hud.rain>.65?'山雨漸急':hud.rain>.35?'細雨入山':'雲開見日'}</span></div>
   <div className="stats-pair"><div><span>全程</span><strong>2.30 <small>km</small></strong></div><div><span>落差</span><strong>{hud.elevation} <small>m</small></strong></div></div>
  </aside>
  {(hud.status==='ready'||hud.status==='finished')&&<section className="start-panel">
   <div className="title-composition"><h1>{hud.status==='finished'?'抵達':'墨落'}</h1><span className="title-inscription">一 筆 入 山<br/>一 路 向 下</span><span className="artist-seal">山<br/>行</span></div>
   <div className="english-title">{hud.status==='finished'?'THE DESCENT, COMPLETE.':'A DESCENT IN INK.'}</div>
   <p>{hud.status==='finished'?`第 ${hud.rank} 名 / 4 · ${time(hud.time)} · ${hud.score.toLocaleString()} 分`:'四名騎士，一卷山水。踏出你自己的路。'}</p>
   <button className="start-button" disabled={!loaded||!!error} onClick={()=>api.current?.start()}><span>{error?'未能開啟畫面':!loaded?'山水落筆中…':hud.status==='finished'?'再下一程':'入 山 起 行'}</span><ArrowUpRight size={22}/></button>
   {error&&<p className="error">無法啟動 3D 畫面。請開啟瀏覽器硬件加速，再重新載入。</p>}
   <div className="rivals"><div><i/>山隼 <small>切彎取內線</small></div><div><i/>流雲 <small>穩健走線</small></div><div><i/>飛燕 <small>躍台搶先</small></div></div>
  </section>}
  {hud.status==='paused'&&<section className="pause-panel"><span className="tiny">山 間 小 歇</span><h2>歇一歇。</h2><button className="start-button" onClick={()=>api.current?.pause()}>繼 續 下 山 <Play size={20}/></button><button className="text-button" onClick={()=>api.current?.start()}><RotateCcw size={16}/> 重新起行</button></section>}
  {active&&<><aside className="leaderboard"><div className="position">{hud.rank}<span>/ 4</span></div>{hud.riders.map((r,i)=><div key={r.name} className={r.name==='YOU'?'your-row':''}><span>{i+1}</span><b>{riderName(r.name)}</b><small>{r.gap==='FIN'?'抵達':r.gap}</small></div>)}</aside><div className="race-clock"><span className="tiny">行 程 計 時</span><b>{time(hud.time)}</b></div></>}
  {hud.trick&&active&&<div className={`trick ${hud.status==='crashed'?'crash':''}`}><span>{hud.status==='crashed'?'重 拾 平 衡':'行 雲 流 水'}</span><strong>{trickName(hud.trick)}</strong><small>{hud.score.toLocaleString()} 分</small></div>}
  <aside className="route-map"><span className="map-label">山 徑</span><svg viewBox="0 0 100 280" aria-label="賽道進度"><path className="map-shadow" d={hud.mapPath}/><path className="map-line" d={hud.mapPath} pathLength="1" strokeDasharray={`${Math.max(.012,hud.progress)} 1`}/></svg><span>{Math.round(hud.progress*2300)} / 2300 m</span></aside>
  <footer className="bottom-hud">
   <div className="controls"><div><kbd>W</kbd><kbd>S</kbd><span>踩踏 / 剎車</span></div><div><kbd>A</kbd><kbd>D</kbd><span>轉向</span></div><div><kbd>SPACE</kbd><span>跳躍</span></div><div><kbd>SHIFT</kbd><span>加速</span></div><div><kbd>Q</kbd><kbd>E</kbd><span>空翻</span></div><div><kbd>ESC</kbd><span>暫停</span></div></div>
   <div className="telemetry"><div className="speed"><b>{Math.round(hud.speed)}</b><span>km/h</span></div><div className="boost-meter"><span>勢 / BOOST <b>{Math.round(hud.boost)}%</b></span><div><i style={{width:`${hud.boost}%`}}/></div><small>{hud.rain>.4?'雨路濕滑，提早剎車':'蓄勢而下，順勢而行'}</small></div></div>
  </footer>
  {active&&<div className="touch-controls">{[['a','左'],['d','右'],['s','剎車'],[' ','跳'],['e','空翻'],['Shift','加速'],['w','踩踏']].map(([key,label])=><button key={key} onPointerDown={e=>{e.preventDefault();e.currentTarget.setPointerCapture(e.pointerId);api.current?.key(key,true);}} onPointerUp={()=>api.current?.key(key,false)} onPointerCancel={()=>api.current?.key(key,false)}>{label}</button>)}</div>}
  <div className="edition"><span>墨 落 / INKFALL</span><span>水墨卷 · 〇二</span></div>
 </main>;
}
