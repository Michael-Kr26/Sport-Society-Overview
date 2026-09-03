'use strict';
const test=require('node:test');const assert=require('node:assert/strict');const fs=require('node:fs');const path=require('node:path');
const root=path.join(__dirname,'..');const read=(file)=>fs.readFileSync(path.join(root,file),'utf8');
const migrated=['dashboard.css','dashboard-quality.css','dashboard-v15.css','cf.css','create.css','login.css','employee-settings.css','roster-overview.css','roster.css','planner-theme.css','changelog.css','help.css','staffing.css','staffing-standards.css','cml.css','hours.css','visitors.css','healthplanner.css'];

test('actieve basis importeert design system en niet quiet-blue',()=>{const styles=read('styles.css');const nav=read('navigation.css');assert.match(styles,/sso-design-system\.css/);assert.doesNotMatch(styles,/quiet-blue\.css/);assert.doesNotMatch(nav,/quiet-blue\.css/);});

test('gemigreerde modules bevatten geen oud dark theme, extreme font weights of important overrides',()=>{for(const file of migrated){const css=read(file);assert.doesNotMatch(css,/#121212|#1b1b1b|#111111|#141414|#171a1d|#111820|#0c1219/);assert.doesNotMatch(css,/font-weight:\s*(?:8\d\d|9\d\d)/);assert.doesNotMatch(css,/!important/);}});

test('planner theme is geen cascade-reparatielaag meer',()=>{const css=read('planner-theme.css');assert.ok(css.length<500);assert.doesNotMatch(css,/!important/);});

test('design system bevat low-fatigue tokens en focus state',()=>{const css=read('sso-design-system.css');assert.match(css,/--sso-bg:\s*#f4f7fb/i);assert.match(css,/--sso-navy:\s*#0b1d38/i);assert.match(css,/--sso-primary:\s*#0f66df/i);assert.match(css,/focus-visible/);assert.match(css,/prefers-reduced-motion/);});
