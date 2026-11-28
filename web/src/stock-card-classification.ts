/** Display-only classification. KRX membership and reported event themes are separate. */
export const EVENT_THEMES:Record<string,{name:string;label:string;day:string;source:string;url:string;basis:string}>={
 '100790':{name:'미래에셋벤처투자',label:'SpaceX',day:'2026-04-14',source:'뉴스핌',url:'https://www.newspim.com/news/view/20260414000253',basis:'미래에셋그룹 투자 과정에서 회사 자금 투입 보도'},
 '027360':{name:'아주IB투자',label:'SpaceX',day:'2026-04-14',source:'뉴스핌',url:'https://www.newspim.com/news/view/20260414000253',basis:'미국 자회사를 통한 간접 투자 보도'}
};
type IndexTheme={label:string;index:string};
const isLabel=(x:unknown):x is string=>typeof x==='string'&&x.trim().length>0&&x.length<=100;
const validDay=(x:unknown):x is string=>typeof x==='string'&&/^20\d{2}-\d{2}-\d{2}$/.test(x)&&Number.isFinite(Date.parse(x))&&new Date(x+'T00:00:00Z').toISOString().slice(0,10)===x;
export function stockCardClassification(code:string,name:string,day:string,extras?:Record<string,unknown>){
 const x=extras?.stock_card_classification as {source?:unknown;asof?:unknown;industry?:unknown;market?:unknown;themes?:unknown;theme_coverage?:{available?:unknown;total?:unknown}}|undefined;
 let industry:string|null=null,market:string|null=null,asof:string|null=null,themes:IndexTheme[]=[];
 if(validDay(day)&&x?.source==='KRX_DATED_REFERENCE'&&validDay(x.asof)&&x.asof<=day&&Date.parse(day)-Date.parse(x.asof)<=7*86400000&&['KOSPI','KOSDAQ'].includes(String(x.market))){
  asof=x.asof;industry=isLabel(x.industry)?x.industry:null;market=String(x.market);
  if(Array.isArray(x.themes))themes=x.themes.filter((t):t is IndexTheme=>!!t&&isLabel(t.label)&&isLabel(t.index)).slice(0,40);
 }
 const e=Object.hasOwn(EVENT_THEMES,code)?EVENT_THEMES[code]:null;
 const event=e&&name===e.name&&validDay(day)&&day>=e.day?e:null;
 return {industry,market,asof,themes,event,labels:[...new Set(themes.map(t=>t.label))]};
}
