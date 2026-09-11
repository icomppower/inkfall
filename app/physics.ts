// Deterministic fixed-step bicycle dynamics; metres, seconds, radians.
export const LENGTH=2300;
export const clamp=(v:number,a:number,b:number)=>Math.max(a,Math.min(b,v));
export const ramps=[95,210,350,490,655,805,960,1110,1280,1460,1620,1800,1970,2160];
export function rampHeight(s:number){let h=0;for(const r of ramps){const d=s-r;if(d>=-11&&d<0)h=Math.max(h,2.9*Math.pow((d+11)/11,1.6));if(d>=0&&d<6)h=Math.max(h,2.9*(1-d/6));}return h;}
export type Ground=(s:number,l:number)=>number;
export type Input={pedal:boolean;brake:boolean;steer:number;boost:boolean;hop:boolean;trick:number};
export type BikeState={s:number;l:number;speed:number;lv:number;y:number;vy:number;pitch:number;omega:number;air:boolean;airtime:number;rotation:number;tricks:number;boost:number;score:number;crash:number;hopCooldown:number;front:number;rear:number;slip:number;landed:number};
export function makeState(ground:Ground,s=0,l=0):BikeState{return{s,l,speed:0,lv:0,y:ground(s,l)+1.02,vy:0,pitch:Math.atan2(ground(s+.9,l)-ground(s-.9,l),1.8),omega:0,air:false,airtime:0,rotation:0,tricks:0,boost:100,score:0,crash:0,hopCooldown:0,front:.13,rear:.13,slip:0,landed:0};}
export function crash(b:BikeState){if(b.crash>0)return;b.crash=1.7;b.speed*=.24;b.lv=0;b.rotation=0;b.tricks=0;}
export function stepBike(b:BikeState,input:Input,dt:number,wet:number,ground:Ground){
 b.landed=0;b.hopCooldown=Math.max(0,b.hopCooldown-dt);
 if(b.crash>0){b.crash-=dt;if(b.crash<=0){b.l=clamp(b.l,-3.5,3.5);b.y=ground(b.s,b.l)+1.02;b.vy=0;b.pitch=Math.atan2(ground(b.s+.9,b.l)-ground(b.s-.9,b.l),1.8);b.omega=0;b.air=false;}return;}
 const oldGround=ground(b.s,b.l),slope=(ground(b.s+1,b.l)-ground(b.s-1,b.l))/2;
 const grip=1-wet*.43, boosting=input.boost&&b.boost>1&&b.speed>2;
 b.boost=clamp(b.boost+(boosting?-24:5.5)*dt,0,100);
 const offroad=Math.abs(b.l)>5.5;
 const accel=-slope*9.81+(input.pedal?5.3:0)+(boosting?9:0)-.0105*b.speed*b.speed-(offroad?4.5:.5)-(input.brake?(12*grip+1):0);
 b.speed=clamp(b.speed+accel*dt,0,boosting?35:29);
 const lateralTarget=input.steer*(1.2+b.speed*.17);
 const traction=(input.brake?2.1:6.5)*grip;
 b.lv+=(lateralTarget-b.lv)*Math.min(1,traction*dt);
 b.slip=(input.brake?Math.abs(b.lv)/5:Math.abs(lateralTarget-b.lv)/8)*(b.speed/20);
 b.l+=b.lv*dt;b.s=Math.min(LENGTH,b.s+b.speed*dt);
 if(Math.abs(b.l)>9){crash(b);return;}
 const newGround=ground(b.s,b.l),gv=(newGround-oldGround)/dt;
 const frontGround=ground(b.s+.9,b.l),rearGround=ground(b.s-.9,b.l);
 const frontAnchor=b.y+Math.sin(b.pitch)*.9, rearAnchor=b.y-Math.sin(b.pitch)*.9;
 b.front=clamp(frontGround+1.15-frontAnchor,0,.66);b.rear=clamp(rearGround+1.15-rearAnchor,0,.66);
 const frontForce=b.front>0?clamp(b.front*85-(b.vy+b.omega*.9-gv)*5.8,0,100):0;
 const rearForce=b.rear>0?clamp(b.rear*85-(b.vy-b.omega*.9-gv)*5.8,0,100):0;
 const contact=b.front>0||b.rear>0;
 const wasAir=b.air;b.air=!contact;
 if(contact&&wasAir&&b.airtime>.15){const slopePitch=Math.atan2(frontGround-rearGround,1.8);const err=Math.abs(Math.atan2(Math.sin(b.pitch-slopePitch),Math.cos(b.pitch-slopePitch)));if(err>1.05||b.vy-gv<-18){crash(b);return;}b.landed=1;b.score+=Math.round(b.airtime*100)+b.tricks*500;b.boost=clamp(b.boost+8+b.tricks*12,0,100);b.pitch=slopePitch;b.omega*=.3;b.rotation=0;b.tricks=0;b.airtime=0;}
 if(contact&&wasAir&&b.airtime<=.15){b.airtime=0;b.rotation=0;b.tricks=0;}
 if(b.air){b.airtime+=dt;if(input.trick&&b.airtime>.12){const turn=input.trick*8.4*dt;b.rotation+=turn;b.pitch+=turn;b.tricks=Math.floor(Math.abs(b.rotation)/(Math.PI*2));}else{const desired=Math.atan2(frontGround-rearGround,1.8);b.pitch+=Math.atan2(Math.sin(desired-b.pitch),Math.cos(desired-b.pitch))*dt*1.9;}}
 else{b.omega+=((frontForce-rearForce)*1.1-b.omega*7)*dt;b.pitch+=b.omega*dt;}
 b.vy+=(frontForce+rearForce-22)*dt;b.y+=b.vy*dt;
 if(input.hop&&contact&&b.hopCooldown===0){b.vy=Math.max(b.vy,gv)+8.7;b.y+=.14;b.hopCooldown=.8;b.air=true;b.airtime=0;}
 if(b.y<newGround+.44){b.y=newGround+.44;b.vy=Math.max(b.vy,gv);}
}
