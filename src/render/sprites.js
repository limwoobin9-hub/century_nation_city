/** CENTURY original 2:1 isometric art. Pixel geometry uses a single upper-left light. */
import { BUILDINGS } from '../../data/buildings.js';

const TILE_X = 32, TILE_Y = 16;
const sprites = new Map(), trees = new Map(), pending = new Set(), custom = new Map();
let aiTextile = null;
const warnedAssets = new Set();
function warnMissingAsset(path) {
  if(warnedAssets.has(path))return;
  warnedAssets.add(path);
  console.warn(`[CENTURY] Missing built-in sprite ${path}; using original Canvas fallback.`);
}
const ASSET_ROOT = new URL('../../assets/', import.meta.url);
const P = {
  cream: ['#ded3b0', '#b5a789', '#f1e6c8'],
  brick: ['#b8795a', '#8b5946', '#d59c75'],
  rose: ['#c18d76', '#956a59', '#dfb497'],
  stone: ['#b6b7a7', '#8d978c', '#d3d2bd'],
  plaster: ['#d5c7a4', '#b5a17c', '#e8d9b7'],
  red: ['#a45c47', '#774b3c', '#c87f5b'],
  slate: ['#75858b', '#515f68', '#99a5a5'],
};
const ROOFS = [['#807566', '#5c5e58', '#b1a18a'], ['#776e68', '#505c61', '#a39b8c'], ['#a66f52', '#7c5746', '#ce9b69'], ['#6f8985', '#4d6869', '#a1b2a1']];

const clamp = (n,a,b) => Math.min(b,Math.max(a,n));
function seed(type,level,variant) { let n=level*97+variant*289; for(const c of type) n=(n*31+c.charCodeAt(0))>>>0; return n; }
function randomSource(n) { return () => { n=(1664525*n+1013904223)>>>0;return n/4294967296; }; }
function canvas(w,h) { const c=document.createElement('canvas'); c.width=Math.ceil(w);c.height=Math.ceil(h);return c; }
function loadImage(url) { return new Promise((resolve,reject)=>{const im=new Image();im.onload=()=>resolve(im);im.onerror=reject;im.src=url;}); }
function spriteKey(type,l,v) { return `${type}:${clamp(Math.round(l)||1,1,4)}:${((Math.round(v)||0)%4+4)%4}`; }

class Painter {
  constructor(w,h,height,random) {
    this.w=w;this.h=h;this.width=(w+h)*32+16;this.height=height;
    this.image=canvas(this.width,height);this.ctx=this.image.getContext('2d');this.ctx.imageSmoothingEnabled=false;
    this.random=random;this.ox=this.width/2-(w-h)*16;this.oy=height-8-(w+h)*16;
  }
  p(x,y,z=0) { return [Math.round(this.ox+(x-y)*TILE_X),Math.round(this.oy+(x+y)*TILE_Y-z)]; }
  poly(points,color,stroke) {const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.closePath();c.fillStyle=color;c.fill();if(stroke){c.strokeStyle=stroke;c.lineWidth=1;c.stroke();}}
  iso(points,color,stroke){this.poly(points.map(p=>this.p(...p)),color,stroke);}
  line(points,color,width=1) {const c=this.ctx;c.beginPath();points.forEach((p,i)=>i?c.lineTo(...p):c.moveTo(...p));c.strokeStyle=color;c.lineWidth=width;c.stroke();}
  iline(points,color,width=1){this.line(points.map(p=>this.p(...p)),color,width);}
  rect(x,y,w,h,color){this.ctx.fillStyle=color;this.ctx.fillRect(Math.round(x),Math.round(y),Math.round(w),Math.round(h));}
  oval(x,y,rx,ry,color){const c=this.ctx;c.fillStyle=color;c.beginPath();c.ellipse(Math.round(x),Math.round(y),rx,ry,0,0,Math.PI*2);c.fill();}
  box(x,y,w,h,z,height,pal=P.brick,windows=true) {
    const top=z+height;
    this.iso([[x,y+h,z],[x+w,y+h,z],[x+w,y+h,top],[x,y+h,top]],pal[0],'#625d4b');
    this.iso([[x+w,y,z],[x+w,y+h,z],[x+w,y+h,top],[x+w,y,top]],pal[1],'#625d4b');
    if(height>11) {
      for(let zz=z+4;zz<top-2;zz+=4) {
        this.iline([[x+.03,y+h+.005,zz],[x+w-.03,y+h+.005,zz]],pal[1]);
        this.iline([[x+w+.005,y+.03,zz],[x+w+.005,y+h-.03,zz]],'#71614e');
        for(let u=x+.1+((zz/4)%2)*.14;u<x+w;u+=.29) this.iline([[u,y+h+.01,zz],[u,y+h+.01,zz+3]],pal[2]);
      }
    }
    this.iso([[x,y,top],[x+w,y,top],[x+w,y+h,top],[x,y+h,top]],pal[2],'#625d4b');
    if(windows) {
      const floors=Math.floor(height/16),cols=Math.max(1,Math.round(w*2));
      for(let f=0;f<floors;f++) {
        for(let i=0;i<cols;i++) this.window(x+(i+.28)*w/cols,y+h+.014,z+5+f*16,w/cols*.38,7,'u');
        const sidecols=Math.max(1,Math.round(h*2));
        for(let i=0;i<sidecols;i++) this.window(x+w+.014,y+(i+.28)*h/sidecols,z+5+f*16,h/sidecols*.38,7,'v');
      }
    }
    this.iline([[x,y+h,top-2],[x+w,y+h,top-2],[x+w,y,top-2]],pal[2],2);
    return top;
  }
  window(x,y,z,width,height,face='u',lit=false) {
    const point=(d,zz)=>face==='u'?[x+d,y,zz]:[x,y+d,zz];
    this.iso([point(0,z),point(width,z),point(width,z+height),point(0,z+height)],'#45575a');
    const glass=(lit||this.random()>.77)?'#e7cf91':face==='u'?'#b2c6bd':'#8ba9aa';
    this.iso([point(.025,z+1),point(width-.025,z+1),point(width-.025,z+height-1),point(.025,z+height-1)],glass);
    this.iline([point(width/2,z+.6),point(width/2,z+height)],'#586765');
    this.iline([point(0,z+height/2),point(width,z+height/2)],'#6c7770');
    this.iline([point(-.025,z-1),point(width+.025,z-1)],'#e2d4b3',2);
    this.iline([point(-.01,z+height+1),point(width+.01,z+height+1)],'#d0b891');
  }
  door(x,y,face='u',wide=.17,height=10,z=2) {
    const p=(d,zz)=>face==='u'?[x+d,y,zz]:[x,y+d,zz];
    this.iso([p(-.03,z),p(wide+.03,z),p(wide+.03,z+height+1),p(-.03,z+height+1)],'#d2c4a3');
    this.iso([p(0,z),p(wide,z),p(wide,z+height),p(0,z+height)],'#554e3e');
    this.iline([p(wide/2,z+1),p(wide/2,z+height-1)],'#a38b59');
    const q=this.p(...p(wide*.8,z+height*.4));this.rect(q[0],q[1],1,1,'#e7ce85');
  }
  roof(x,y,w,h,z,pal,kind='gable') {
    const roof=pal||ROOFS[0], rise=8+Math.min(w,h)*4;
    if(kind==='flat') {
      this.box(x-.025,y-.025,w+.05,h+.05,z,3,roof,false);
      this.iso([[x+.08,y+.08,z+3],[x+w-.08,y+.08,z+3],[x+w-.08,y+h-.08,z+3],[x+.08,y+h-.08,z+3]],roof[1]);
      for(let i=.2;i<w;i+=.25) this.iline([[x+i,y+.08,z+3],[x+i,y+h-.08,z+3]],'#5d6867');
      return z+3;
    }
    const ridge=y+h/2;
    this.iso([[x-.06,y-.06,z],[x+w+.06,y-.06,z],[x+w+.06,ridge,z+rise],[x-.06,ridge,z+rise]],roof[1],'#4d5754');
    this.iso([[x-.06,ridge,z+rise],[x+w+.06,ridge,z+rise],[x+w+.06,y+h+.06,z],[x-.06,y+h+.06,z]],roof[0],'#4d5754');
    this.iso([[x+w+.06,y-.06,z],[x+w+.06,y+h+.06,z],[x+w+.06,ridge,z+rise]],roof[1],'#4d5754');
    const steps=6;for(let i=1;i<steps;i++) {const t=i/steps;this.iline([[x-.04,ridge+h/2*t,z+rise*(1-t)],[x+w+.04,ridge+h/2*t,z+rise*(1-t)]],roof[1]);}
    for(let u=.1;u<w;u+=.18)this.iline([[x+u,ridge,z+rise],[x+u,y+h+.04,z]],roof[2]);
    this.iline([[x-.07,ridge,z+rise],[x+w+.07,ridge,z+rise]],roof[2],2);
    this.iline([[x-.06,y+h+.06,z],[x+w+.06,y+h+.06,z]],'#d2c0a0',2);
    return z+rise;
  }
  chimney(x,y,z,height=17) {this.box(x,y,.13,.14,z,height,P.red,false);this.box(x-.025,y-.025,.18,.19,z+height,2,P.stone,false);this.iso([[x+.02,y+.02,z+height+2],[x+.11,y+.02,z+height+2],[x+.11,y+.12,z+height+2],[x+.02,y+.12,z+height+2]],'#434d45');}
  cylinder(x,y,z,r,h,color='#9a7457') {const [cx,cy]=this.p(x,y,z),[tx,ty]=this.p(x,y,z+h);this.rect(cx-r,ty,2*r,h,color);this.oval(cx,cy,r,r/2,'#6e6558');this.oval(tx,ty,r,r/2,'#b4a98f');this.line([[cx-r,ty],[cx-r,cy]],'#c1b297',2);this.line([[cx+r,ty],[cx+r,cy]],'#5d6057',2);for(let yy=ty+8;yy<cy;yy+=9)this.line([[cx-r,yy],[cx+r,yy]],'#756451');}
  tree(x,y,size=1,variant=0) {
    const [px,py]=this.p(x,y);this.oval(px+3,py+2,10*size,4*size,'#67715155');this.rect(px-1,py-20*size,3,21*size,'#72604b');
    const colors=variant===3?['#ae9056','#8f824e','#c8ac68']:['#6a8b62','#4e7357','#89a06d'];
    for(const [dx,dy,r,c] of [[0,-25,12,1],[-7,-24,9,0],[6,-21,9,1],[-4,-33,9,0],[-6,-33,6,2],[3,-32,7,0],[3,-17,7,1]]) this.oval(px+dx*size,py+dy*size,r*size,r*.8*size,colors[c]);
    this.rect(px-6*size,py-35*size,4*size,2*size,colors[2]);
  }
  fence(x,y,w,h) {for(let i=0;i<=w;i+=.2){const [px,py]=this.p(x+i,y+h);this.rect(px,py-6,1,7,'#baa98a');}for(let j=0;j<=h;j+=.2){const [px,py]=this.p(x+w,y+j);this.rect(px,py-6,1,7,'#a79477');}this.iline([[x,y+h,4],[x+w,y+h,4],[x+w,y,4]],'#d5c5a2');}
  flag(x,y,z,color='#b9684f') {const [px,py]=this.p(x,y,z);this.rect(px,py-15,1,16,'#787e6b');this.poly([[px+1,py-15],[px+9,py-13],[px+9,py-8],[px+1,py-10]],color);}
  bench(x,y){this.box(x,y,.3,.12,2,2,['#9c7957','#735b43','#bfa177'],false);this.iline([[x,y,5],[x+.3,y,5]],'#8d714f',2);}
  lamp(x,y){const [px,py]=this.p(x,y);this.rect(px,py-13,1,13,'#485f58');this.rect(px-2,py-17,5,5,'#636b59');this.rect(px-1,py-16,3,3,'#ead5a1');this.rect(px-1,py,3,1,'#5f6b5b');}
  ground(kind='paving') {
    const w=this.w,h=this.h;
    this.iso([[0,0,-1],[w,0,-1],[w,h,-1],[0,h,-1]],'#7c8266');
    this.iso([[.02,.02,0],[w-.02,.02,0],[w-.02,h-.02,0],[.02,h-.02,0]],kind==='grass'?'#8eaa73':kind==='dirt'?'#b7a57c':'#b9b5a0');
    if(kind==='paving'){
      for(let u=.25;u<w;u+=.25)this.iline([[u,0,0],[u,h,0]],'#a4a58f');
      for(let v=.25;v<h;v+=.25)this.iline([[0,v,0],[w,v,0]],'#cbc6ae');
    } else for(let i=0;i<(w+h)*6;i++){const x=this.random()*w,y=this.random()*h;const q=this.p(x,y);this.rect(q[0],q[1],2,1,kind==='grass'?'#a6b981':'#c5b58a');}
    this.iline([[.02,h-.02,0],[w-.02,h-.02,0],[w-.02,.02,0]],'#d5cfb0');
  }
  result(){return {image:this.image,width:this.width,height:this.height,anchorX:this.width/2,anchorY:this.height-8};}
}

/** Deterministic original pixel geometry; exported for repeatable PNG generation. */
export function createSprite(type,level=1,variant=0) {
  const def=BUILDINGS[type]||{width:1,height:1,category:'residential'},w=def.width,h=def.height;
  level=clamp(Math.round(level)||1,1,4);variant=((variant%4)+4)%4;
  const rnd=randomSource(seed(type,level,variant));
  const p=new Painter(w,h,128+(w+h)*16,rnd), roof=ROOFS[variant], pal=[P.brick,P.plaster,P.rose,P.stone][variant];
  const civic=['school','hospital','police','fire','bank','university','townhall','museum','theatre','post','government','parliament','centralbank'];
  p.ground(['park','farm','lumber'].includes(type)?'grass':'paving');
  if(type==='park') {
    p.iso([[0,.82,1],[w,.82,1],[w,1.13,1],[0,1.13,1]],'#c9b78c');
    p.iso([[.82,0,1],[1.12,0,1],[1.12,h,1],[.82,h,1]],'#c9b78c');
    p.tree(.34,.36,1.12,variant);p.tree(1.5,.4,1,variant);p.tree(.3,1.56,.8,variant);p.tree(1.7,1.65,.9,variant);
    const c=p.p(1,1,1);p.oval(...c,12,6,'#ddd1b4');p.oval(c[0],c[1]-1,9,4,'#6faaa6');p.cylinder(1,1,3,3,8,'#c8c4aa');
    if(level>1){p.bench(.22,1.2);p.bench(1.25,.7);}if(level>2){p.lamp(.8,.1);p.lamp(1.1,1.8);}p.fence(0,0,w,h);return p.result();
  }
  if(type==='farm') {
    for(let row=0;row<7;row++) {
      const y=.38+row*.33;
      p.iso([[.18,y,1],[2.8,y,1],[2.8,y+.18,1],[.18,y+.18,1]],'#887955');
      for(let x=.3;x<2.9;x+=.19) {const q=p.p(x,y+.12);p.rect(q[0],q[1]-3,2,4,['#aab267','#c2b46b','#8caa68','#b5a85f'][variant]);p.rect(q[0]-1,q[1]-4,4,1,'#cfbb79');}
    }
    let top=p.box(.18,.15,.9,.65,1,17+level*2,P.red);p.roof(.18,.15,.9,.65,top,ROOFS[2]);p.door(.48,.816,'u',.22,12);p.cylinder(1.33,.35,1,9,29,'#c0b894');p.fence(0,0,w,h);return p.result();
  }
  if(type==='house'||type==='shop'||type==='apartment') {
    const isShop=type==='shop',isApartment=type==='apartment';
    const floors=isApartment?2+level:level<3?1:2;
    const bw=isApartment?1.64:.77,bh=isApartment?1.55:.72;
    const x=isApartment?.15:.11,y=isApartment?.16:.08;
    if(variant%2===0&&!isShop)p.tree(w-.13,.19,.45,variant);
    const top=p.box(x,y,bw,bh,2,floors*(isApartment?15:17),pal);
    p.roof(x,y,bw,bh,top,roof,isApartment?'flat':'gable');
    if(!isApartment)p.chimney(x+.12,y+.19,top+5,12+level*2);
    else{p.box(.3,.3,.43,.4,top+3,7,P.slate,false);p.chimney(1.2,.3,top+3,10);}
    p.door(x+bw*.49,y+bh+.02,'u',isApartment?.23:.16,isApartment?13:10);
    if(isShop) {
      const z=11;
      for(let i=0;i<7;i++) p.iso([[x+i*bw/7,y+bh,z+3],[x+(i+1)*bw/7,y+bh,z+3],[x+(i+1)*bw/7,y+bh+.22,z],[x+i*bw/7,y+bh+.22,z]],i%2?'#e1d3ac':['#708b71','#927958','#a76752','#667f88'][variant]);
      p.iline([[x,y+bh+.23,z],[x+bw,y+bh+.23,z]],'#5b705f');
      p.box(x+.04,y+bh+.08,.2,.13,1,4,['#a68d61','#7f7054','#c9aa74'],false);
      p.window(x+.08,y+bh+.019,3,.25,7,'u',true);
    } else {p.fence(.03,.03,w-.06,h-.06);p.iso([[x+bw*.4,y+bh,1],[x+bw*.65,y+bh,1],[x+bw*.65,h,1],[x+bw*.4,h,1]],'#c9bc99');}
    if(level===4&&!isApartment)p.box(x+bw*.7,y+.1,.2,.28,top+8,10,P.cream,true);
    if(isApartment){p.lamp(.07,h-.14);p.tree(w-.13,h-.15,.55,variant);}
    return p.result();
  }
  if(civic.includes(type)) {
    const publicPal=['hospital','bank','museum','government','parliament','centralbank'].includes(type)?P.cream:type==='fire'?P.red:type==='police'?P.stone:pal;
    const x=.16,y=.15,bw=w-.32,bh=h-.48;
    const floors=['townhall','university','government','parliament','centralbank'].includes(type)?2+Math.floor(level/2):1+Math.floor(level/2);
    const top=p.box(x,y,bw,bh,3,floors*16,publicPal);
    p.roof(x,y,bw,bh,top,roof,['bank','museum','centralbank','hospital'].includes(type)?'flat':'gable');
    const front=y+bh;
    p.door(x+bw*.43,front+.02,'u',Math.min(.28,bw*.25),13);
    if(['townhall','government','parliament','university'].includes(type)) {
      const towerX=x+bw*.42,towerY=y+bh*.3,tw=Math.min(.55,bw*.4);
      const tt=p.box(towerX,towerY,tw,.48,top+5,17+level*3,P.cream,false);
      p.roof(towerX,towerY,tw,.48,tt,ROOFS[3]);
      const [cx,cy]=p.p(towerX+tw*.5,towerY+.49,tt-8);p.oval(cx,cy,4,4,'#efe0b3');p.line([[cx,cy-3],[cx,cy],[cx+2,cy+1]],'#5e685a');p.flag(towerX+tw*.6,towerY+.26,tt+9);
    }
    if(['bank','museum','centralbank','parliament'].includes(type)) {
      const z=top+3;
      p.iso([[x-.02,front+.12,z],[x+bw+.02,front+.12,z],[x+bw*.5,front+.12,z+12]],publicPal[2],'#9c967f');
      for(let u=x+.15;u<x+bw;u+=.35){p.box(u,front+.02,.065,.12,3,14,P.cream,false);}
      for(let i=0;i<3;i++)p.box(x+bw*.2-i*.04,front+.1+i*.06,bw*.6+i*.08,.15,0,3-i*.7,P.stone,false);
    }
    if(type==='hospital'){const [cx,cy]=p.p(x+bw*.5,y+bh*.5,top+5);p.rect(cx-5,cy-2,10,4,'#b16a58');p.rect(cx-2,cy-5,4,10,'#b16a58');}
    if(type==='fire'){for(let u=x+.12;u<x+bw;u+=.32)p.door(u,front+.03,'u',.24,12);}
    if(type==='theatre'){p.box(x+bw*.18,front+.02,bw*.64,.24,12,3,P.red,false);}
    p.lamp(.06,h-.1);if(w>=2){p.tree(w-.15,h-.17,.55,variant);p.bench(.18,h-.23);}return p.result();
  }
  if(['station','depot','warehouse','port','shipyard'].includes(type)) {
    if(type==='port'||type==='shipyard') {
      p.iso([[.02,1.65,1],[w-.02,1.65,1],[w-.02,h-.02,1],[.02,h-.02,1]],'#738f91');
      for(let u=.2;u<w;u+=.19)p.iline([[u,1.55,3],[u,h-.07,3]],'#b5ab8b',2);
      const top=p.box(.15,.1,1.5,1.2,2,23+level*3,P.brick);p.roof(.15,.1,1.5,1.2,top,roof);
      p.iline([[2,.65,0],[2,.65,60],[1,.65,56],[1,.65,43]],'#696e5c',3);p.iline([[2,.65,52],[1,.65,43]],'#aaa28b');
      p.iso([[1.2,2.2,3],[2.55,2.2,3],[2.8,2.5,3],[1.2,2.68,3]],'#574f3f');p.box(1.45,2.26,.7,.32,6,10,P.cream,false);
      p.box(2.28,.3,.35,.35,1,10,P.plaster,false);p.box(2.3,.74,.35,.35,1,10,P.plaster,false);
    } else {
      const bw=type==='station'?w-.32:w-.3,bh=type==='station'?.83:h-.45;
      const top=p.box(.15,.15,bw,bh,2,18+level*4,type==='station'?P.cream:pal);p.roof(.15,.15,bw,bh,top,roof);
      p.door(.35,bh+.17,'u',.25,13);
      if(type==='station') {
        p.box(.03,1.22,w-.06,.4,1,3,P.stone,false);
        p.iline([[.08,1.3,29],[w-.08,1.3,29]],'#7d8c7a',4);p.iline([[.08,1.66,24],[w-.08,1.66,24]],'#7d8c7a',4);
        p.iso([[.08,1.3,29],[w-.08,1.3,29],[w-.08,1.66,24],[.08,1.66,24]],'#86958b','#596e63');
        for(let u=.15;u<w;u+=.5)p.iline([[u,1.66,1],[u,1.66,24]],'#61776b',2);
        for(const v of [1.75,1.93])p.iline([[0,v,1],[w,v,1]],'#696d60',2);
        const [cx,cy]=p.p(.9,1.0,top-5);p.oval(cx,cy,4,4,'#eee0b7');p.line([[cx,cy-2],[cx,cy],[cx+2,cy]],'#566357');
      }else{for(let i=0;i<3;i++)p.box(.2+i*.4,h-.26,.3,.22,1,5,P.plaster,false);}
    }return p.result();
  }
  if(type==='lumber'){p.tree(.35,.25,.8,variant);p.tree(w-.3,.35,.9,variant);}
  const industrial=['textile','steel','power','industrial','machine','auto','chemical','refinery','coal','iron','oilwell','lumber'].includes(type);
  if(industrial) {
    const bw=w-.4,bh=h-.65,facPal=type==='power'?P.stone:pal;
    if(['coal','iron','oilwell'].includes(type)) {
      const cx=w*.55,cy=h*.55;
      p.iso([[.2,.3,1],[w-.2,.3,1],[w-.2,h-.2,1],[.2,h-.2,1]],'#8d8d77');
      p.box(.18,.15,.65,.7,1,17+level*3,P.brick);p.roof(.18,.15,.65,.7,20+level*3,roof);
      for(const dx of [-.32,.32])for(const dy of [-.32,.32])p.iline([[cx+dx*1.7,cy+dy*1.7,1],[cx+dx*.5,cy+dy*.5,65+level*4]],'#58645c',3);
      for(let z=12;z<60;z+=12){p.iline([[cx-.45,cy, z],[cx+.45,cy,z+10],[cx+.4,cy,z],[cx-.4,cy,z+10]],'#9a967c',2);}
      p.box(cx-.2,cy-.2,.4,.4,63+level*4,4,P.slate,false);
      if(type==='oilwell')p.cylinder(w-.35,h-.4,1,14,24,'#89948a');else {for(let i=0;i<4;i++){const q=p.p(.5+i*.25,h-.35);p.oval(q[0],q[1]-3,11,7,type==='iron'?'#937665':'#4f5c54');}}
    } else if(type==='chemical'||type==='refinery') {
      p.box(.15,.15,bw*.5,bh*.6,1,22+level*3,P.stone);p.roof(.15,.15,bw*.5,bh*.6,23+level*3,roof,'flat');
      for(let i=0;i<3;i++)p.cylinder(w-.48-i*.5,.55+i*.32,1,9+i*2,25+level*5,'#a0aaa0');
      p.cylinder(w-.5,h-.53,1,15,26,'#afafa0');p.iline([[.4,h-.4,10],[w-.5,h-.4,10],[w-.5,.5,10]],'#737f78',3);p.chimney(.28,.25,25,34);
    } else {
      const height=17+level*6,top=p.box(.15,.13,bw,bh,2,height,facPal);
      if(['textile','machine','auto'].includes(type)){const count=3;for(let i=0;i<count;i++)p.roof(.15,.13+bh/count*i,bw,bh/count,top,roof);}
      else p.roof(.15,.13,bw,bh,top,roof,type==='power'?'flat':'gable');
      p.door(.38,bh+.15,'u',.36,12);
      p.chimney(w-.34,.27,top,27+level*5);if(level>1||type==='steel')p.chimney(w-.62,.25,top,20+level*4);
      if(type==='steel'||type==='power'){p.cylinder(w-.5,h-.35,1,12,34,'#8c9990');p.box(.2,h-.4,.5,.25,1,8,P.slate,false);}
      else{for(let i=0;i<3;i++)p.box(.17+i*.32,h-.25,.25,.17,1,4,P.plaster,false);}
      if(type==='lumber'){for(let i=0;i<5;i++){const q=p.p(.3+i*.19,h-.28);p.oval(q[0],q[1]-3,5,3,'#8b704c');p.oval(q[0]-1,q[1]-4,3,2,'#c5a77b');}}
    }
    p.lamp(.08,h-.05);return p.result();
  }
  const top=p.box(.13,.13,w-.26,h-.26,2,16+level*7,pal);p.roof(.13,.13,w-.26,h-.26,top,roof);return p.result();
}

function imageSprite(image,type) {
  const def=BUILDINGS[type]||{width:1,height:1},width=(def.width+def.height)*32+16,height=128+(def.width+def.height)*16;
  return {image,width,height,anchorX:width/2,anchorY:height-8};
}
function requestPng(type,level,variant,key) {
  if(pending.has(key)||globalThis.__CENTURY_EXPORT_ASSETS__)return;
  pending.add(key);
  loadImage(new URL(`sprites/${type}-${level}-${variant}.png`,ASSET_ROOT)).then(image=>sprites.set(key,imageSprite(image,type))).catch(()=>warnMissingAsset(`sprites/${type}-${level}-${variant}.png`));
}
export function getSprite(type,level=1,variant=0) {
  if(custom.has(type))return custom.get(type).sprite;
  const l=clamp(Math.round(level)||1,1,4),v=((Math.round(variant)||0)%4+4)%4,key=spriteKey(type,l,v);
  if(type==='textile'&&aiTextile&&v===0) return aiTextile;
  if(!sprites.has(key))sprites.set(key,createSprite(type,l,v));
  requestPng(type,l,v,key);return sprites.get(key);
}
export function getTreeSprite(variant=0) {
  variant=((variant%4)+4)%4;
  if(!trees.has(variant)) {
    const p=new Painter(1,1,112,randomSource(variant+42));p.tree(.5,.5,1.1,variant);
    const r=p.result();r.anchorY=p.p(.5,.5)[1];trees.set(variant,r);
  }return trees.get(variant);
}

export async function loadSprites() {
  await Promise.all([
    ...Object.keys(BUILDINGS).map(async type=>{const key=spriteKey(type,1,0);try{const im=await loadImage(new URL(`sprites/${type}-1-0.png`,ASSET_ROOT));sprites.set(key,imageSprite(im,type));pending.add(key);}catch{warnMissingAsset(`sprites/${type}-1-0.png`);sprites.set(key,createSprite(type,1,0));pending.add(key);}}),
    loadImage(new URL('ai-textile.png',ASSET_ROOT)).then(image=>{const w=148,h=99;aiTextile={image,width:w,height:h,anchorX:w/2,anchorY:h-5+(BUILDINGS.textile.width+BUILDINGS.textile.height)*8};}).catch(()=>warnMissingAsset('ai-textile.png')),
  ]);
  return {count:sprites.size,aiTextile:!!aiTextile};
}

/** User imports remain local and are persisted by the game's save subsystem. */
export async function registerCustomSprite(type,dataUrl) {
  if(!BUILDINGS[type])throw new Error('알 수 없는 건물 종류입니다.');
  if(typeof dataUrl!=='string'||dataUrl.length>7_000_000||!/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/=]+$/.test(dataUrl))throw new Error('5MB 이하 PNG·JPEG·WebP 이미지가 필요합니다.');
  const image=await loadImage(dataUrl);
  if(image.naturalWidth>2048||image.naturalHeight>2048||image.naturalWidth<8||image.naturalHeight<8)throw new Error('이미지 크기는 8~2048 픽셀이어야 합니다.');
  const def=BUILDINGS[type],maxWidth=(def.width+def.height)*32+16,width=maxWidth,height=Math.min(220,width*image.naturalHeight/image.naturalWidth);
  const sprite={image,width,height,anchorX:width/2,anchorY:height-4+(def.width+def.height)*8};
  custom.set(type,{sprite,dataUrl});return sprite;
}
export function clearCustomSprite(type) {custom.delete(type);}
export function customSpriteRecords() {return Object.fromEntries([...custom].map(([type,record])=>[type,record.dataUrl]));}
export async function restoreCustomSprites(records={}) {custom.clear();for(const [type,url] of Object.entries(records))if(BUILDINGS[type]){try{await registerCustomSprite(type,url);}catch{/* Invalid individual imports cannot prevent loading the rest of a valid save. */}}}
export const SPRITE_MANIFEST={projection:'2:1 isometric',tile:[64,32],light:'upper-left',levels:[1,2,3,4],variants:[0,1,2,3],format:'transparent PNG',buildings:Object.keys(BUILDINGS),ai:{type:'textile',variant:0,file:'assets/ai-textile.png'},originalSource:'src/render/sprites.js'};
