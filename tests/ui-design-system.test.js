'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');

test('actieve basis importeert design system en niet quiet-blue',()=>{const styles=read('styles.css');const nav=read('navigation.css');assert.match(styles,/sso-design-system\.css/);assert.doesNotMatch(styles,/quiet-blue\.css/);assert.doesNotMatch(nav,/quiet-blue\.css/);});

test('fase C modules bevatten geen donker thema, extreme font weights of important overrides',()=>{for(const file of ['dashboard.css','dashboard-quality.css','cf.css','create.css','login.css','employee-settings.css']){const css=read(file);assert.doesNotMatch(css,/#121212|#1b1b1b|#111111|#141414|#171a1d/);assert.doesNotMatch(css,/font-weight:\s*(?:8\d\d|9\d\d)/);assert.doesNotMatch(css,/!important/);}});

test('design system bevat low-fatigue tokens en focus state',()=>{const css=read('sso-design-system.css');assert.match(css,/--sso-bg:\s*#f4f7fb/i);assert.match(css,/--sso-navy:\s*#0b1d38/i);assert.match(css,/--sso-primary:\s*#0f66df/i);assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);});
