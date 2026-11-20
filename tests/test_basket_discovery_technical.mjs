import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {test} from 'node:test';
import {analysisTechnicalBadges,discoveryTechnicalBadges,validDiscoveryTechnicalBadges}
 from '../web/src/discovery-technical.ts';

test('reverse alignment uses all three positive, dated MA values',()=>{
 assert.deepEqual(discoveryTechnicalBadges({ma20:'100.5',ma40:'110',ma60:120}),['역배열']);
 for(const extras of [
  {ma20:100,ma40:110},
  {ma20:0,ma40:110,ma60:120},
  {ma20:'bad',ma40:110,ma60:120},
  {ma20:110,ma40:110,ma60:120},
  {ma20:140,ma40:110,ma60:120},
  {ma20:false,ma40:110,ma60:120},
  {ma20:'Infinity',ma40:110,ma60:120}
 ])assert.deepEqual(discoveryTechnicalBadges(extras),[]);
});

test('other dated technical badges stay separate from scanner signal names',()=>{
 assert.deepEqual(discoveryTechnicalBadges({ma_to_up:'true',ma112_cross:1,ma224_cross:'True'}),
  ['정배열 전환','112선 돌파','224선 돌파']);
 assert.deepEqual(discoveryTechnicalBadges({ma_to_up:'false',ma112_cross:'0',ma224_cross:null}),[]);
 assert.deepEqual(analysisTechnicalBadges({MA_INVERSE:true,MA112_CROSS:true,MA224_CROSS:false}),
  ['역배열','112선 돌파']);
});

test('backup reader accepts only a small, unique, allowlisted discovery snapshot',()=>{
 assert.equal(validDiscoveryTechnicalBadges(undefined),false);
 assert.equal(validDiscoveryTechnicalBadges([]),true);
 assert.equal(validDiscoveryTechnicalBadges(['역배열','112선 돌파']),true);
 assert.equal(validDiscoveryTechnicalBadges(['역배열','역배열']),false);
 assert.equal(validDiscoveryTechnicalBadges(['역배열','매수 확정']),false);
 assert.equal(validDiscoveryTechnicalBadges(['역배열',2]),false);
});

test('search, basket capture, exact-day legacy upgrade and rendering share the same evidence',()=>{
 const main=readFileSync(new URL('../web/src/main.tsx',import.meta.url),'utf8');
 const basket=readFileSync(new URL('../web/src/SmartBasket.tsx',import.meta.url),'utf8');
 assert.match(main,/techBadges=\(r:Signal\)=>discoveryTechnicalBadges\(r\.extras\)/);
 assert.match(main,/enqueueBasket\(\{\.\.\.r,name:displayName\(r\)\}\)/);
 assert.match(basket,/technicalBadges=source==='MANUAL'/);
 assert.match(basket,/technicalBadges,\s*\.\.\.\(source==='MANUAL'/);
 assert.match(basket,/const badges=discoveryTechnicalBadges\(found\.extras\)/);
 assert.match(basket,/x\.technicalBadges===undefined&&badges\.length/);
 assert.match(basket,/it\.technicalBadges\?\.map\(t=>/);
});
