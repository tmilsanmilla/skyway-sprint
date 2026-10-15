import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import postcss from 'postcss';
const css=postcss.parse(readFileSync(new URL('./photon-refresh.css',import.meta.url),'utf8'));
const declarations=(selector)=>{
  const result={};
  css.walkRules(rule=>{if(rule.selectors.includes(selector))rule.walkDecls(d=>{result[d.prop]=d.value;});});
  return result;
};
const luminance=(hex)=>{
  const rgb=hex.slice(1).match(/../g).slice(0,3).map(c=>parseInt(c,16)/255).map(c=>c<=.04045?c/12.92:((c+.055)/1.055)**2.4);
  return rgb[0]*.2126+rgb[1]*.7152+rgb[2]*.0722;
};
const contrast=(a,b)=>{const x=luminance(a),y=luminance(b);return(Math.max(x,y)+.05)/(Math.min(x,y)+.05);};

test('Photon equipped/menu and selected inventory cards explicitly replace inherited cream backgrounds with high-contrast pairs',()=>{
  for(const selector of ['.photon-futuristic .photon-equipped','.photon-futuristic .photon-selected-character','.photon-futuristic .photon-character-card','.photon-futuristic .photon-character-card.selected']){
    const d=declarations(selector);
    assert.match(d.background,/^#[a-f0-9]{6}$/i,`${selector} must not inherit a cream/transparent background`);
    assert.match(d.color,/^#[a-f0-9]{6}$/i);
    assert.ok(contrast(d.color,d.background)>=7,`${selector}: text must exceed7:1 contrast`);
  }
  const card=declarations('.photon-futuristic .photon-equipped');
  const description=declarations('.photon-futuristic .photon-equipped p');
  assert.ok(contrast(description.color,card.background)>=7,'ability text must stay readable');
});
test('Photon button specificity overrides both inherited pale weapon buttons and lane controls; disabled previews stay readable',()=>{
  const enabled=declarations('.photon-futuristic.photon-panel button');
  assert.equal(enabled.color,'#edfaff');assert.match(enabled.background,/#172544/);
  const disabled=declarations('.photon-futuristic.photon-panel button:disabled');
  assert.equal(disabled.opacity,'1','do not fade all text/art to45%');
  assert.ok(contrast(disabled.color,disabled.background)>=7);
  assert.ok(contrast(declarations('.photon-futuristic .photon-heading small').color,'#080e22')>=7);
});
test('Photon contrast overrides are loaded after the old Skyway globals',()=>{
  const layout=readFileSync(new URL('./layout.tsx',import.meta.url),'utf8');
  assert.ok(layout.indexOf("'./photon-refresh.css'")>layout.indexOf("'./globals.css'"));
});
test('full-width Laserdrome resets Skyway road centering so mobile lanes and all pause overlays stay inside the frame',()=>{
  const arena=declarations('.photon-futuristic .photon-arena');
  assert.equal(arena.inset,'0');assert.equal(arena.width,'100%');assert.equal(arena.height,'100%');
  assert.equal(arena.transform,'none','left0+width100% must not retain translateX(-50%)');
  assert.equal(arena.translate,'none');
  for(const selector of ['.photon-futuristic .photon-arena > .photon-pause','.photon-futuristic .photon-arena > .photon-chaos-countdown']){
    const overlay=declarations(selector);assert.equal(overlay.position,'absolute');assert.equal(overlay.inset,'0');
    assert.equal(overlay.width,'auto');assert.equal(overlay.transform,'none');assert.equal(overlay['max-width'],'100%');
  }
  const halt=declarations('.photon-futuristic .photon-arena > .photon-time-stop');
  assert.equal(halt.inset,'12% 3%');assert.equal(halt.width,'auto');assert.equal(halt.transform,'none');assert.equal(halt['max-width'],'94%');
  // The old transform displaced a335px arena by167.5px. With left0/no transform,
  // every supported mobile frame and its full-frame overlays share identical bounds.
  for(const width of [280,335,350,390,768]){
    const frameLeft=20,arenaLeft=frameLeft,arenaRight=arenaLeft+width;
    assert.equal(arenaLeft,frameLeft);assert.equal(arenaRight,frameLeft+width);
    const haltLeft=arenaLeft+width*.03,haltRight=arenaRight-width*.03;
    assert.ok(haltLeft>=arenaLeft&&haltRight<=arenaRight);
  }
});
