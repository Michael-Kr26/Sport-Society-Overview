const LOCATIONS = ['Achterveld', 'Barneveld', 'Voorthuizen', 'Wekerom', 'Harskamp'];
const WEEKDAYS = ['zondag', 'maandag', 'dinsdag', 'woensdag', 'donderdag', 'vrijdag', 'zaterdag'];

// Historische weektemplates uit de aangeleverde DEWI-roosters. Reformer Pilates is bewust niet opgenomen.
// De adapter is los van de analyse gehouden zodat deze lijst later één-op-één door live DEWI-data kan worden vervangen.
const LESSON_TEMPLATES = {
    Achterveld: [
        [1,'08:45','09:30','Circuit',8,8,0],[1,'10:00','10:45','Boxing low',4,8,0],[1,'18:45','19:30','HYROX',8,8,1],[1,'19:30','20:15','Circuit',6,8,0],[1,'20:15','21:00','Boxing high',5,10,0],
        [2,'09:15','10:00','Active',5,8,0],[2,'10:00','10:45','Active',7,8,0],[2,'18:45','19:45','Strength',6,8,0],[2,'19:45','20:30','Pilates',10,12,0],[2,'20:30','21:15','Pilates',9,12,0],
        [3,'07:15','08:00','Early Birds',3,8,0],[3,'08:45','09:30','Circuit',7,8,0],[3,'18:45','19:30','BBB',2,8,0],[3,'19:30','20:15','HIIT',3,8,0],[3,'20:15','21:00','Boxing high',5,10,0],
        [4,'09:00','09:45','BBB',4,8,0],[4,'10:00','10:45','Boxing low',3,8,0],[4,'16:15','17:00','Pilates',6,12,0],[4,'18:45','19:45','Strength',7,8,0],[4,'19:45','20:30','Pilates',6,12,0],
        [5,'07:15','08:00','Early Birds',3,8,0],[5,'08:45','09:30','Circuit',7,8,0],[5,'10:00','10:45','Active',6,10,0],
        [6,'09:00','09:45','Circuit',8,8,3],[6,'10:00','11:00','HYROX',0,8,0],
        [0,'09:00','09:45','HYROX',2,8,0],[0,'10:00','10:45','Pilates',12,12,1]
    ],
    Voorthuizen: [
        [1,'08:45','09:30','Circuit',11,14,0],[1,'09:30','10:15','Active',8,14,0],[1,'18:45','19:30','Boxing',9,14,0],[1,'19:30','20:15','Strength',11,18,0],[1,'20:15','21:15','Crosstraining',11,14,0],
        [2,'18:45','19:30','HIIT',10,12,0],[2,'19:30','20:15','Circuit',14,14,0],[2,'20:15','21:00','Pilates',13,14,5],
        [3,'08:00','08:45','Pilates',13,14,3],[3,'08:45','09:30','Pilates',14,14,5],[3,'09:30','10:15','Boxing',4,14,0],[3,'10:15','11:00','Active',6,14,0],[3,'18:45','19:30','Boxing',9,12,0],[3,'19:30','20:45','Crosstraining + HYROX',13,16,0],
        [4,'08:45','09:30','Circuit',6,14,0],[4,'18:45','19:30','Circuit',11,14,0],[4,'19:30','20:30','HYROX',9,14,0],
        [5,'08:45','09:30','Crosstraining',7,14,0],[5,'09:30','10:15','Pilates',12,14,5],[5,'10:15','11:00','Pilates',12,14,2],
        [6,'08:45','09:30','HYROX',11,14,0],[6,'09:30','10:15','Boxing',10,14,1]
    ],
    Barneveld: [
        [1,'08:45','09:30','Circuit',11,12,0],[1,'10:30','11:15','Pilates',10,12,0],[1,'16:30','17:30','HYROX',4,12,0],[1,'18:45','19:30','Circuit',11,14,0],[1,'19:30','20:15','HYROX',6,12,0],
        [2,'08:45','09:30','Circuit',4,12,0],[2,'10:00','10:45','Active',5,8,0],[2,'11:00','11:45','Pilates',11,12,0],[2,'18:45','19:30','HIIT',1,12,0],[2,'19:30','20:15','Strength',8,12,0],[2,'20:15','21:00','Boxfit',12,12,0],
        [3,'08:45','09:30','Boxfit',9,14,0],[3,'09:30','10:15','Circuit',4,12,0],[3,'18:45','19:30','Circuit',9,12,0],[3,'20:15','21:00','HYROX',12,12,1],
        [4,'08:45','09:30','Circuit',11,12,0],[4,'09:45','10:30','Active',4,8,0],[4,'11:00','11:45','Pilates',9,12,0],[4,'19:30','20:15','Circuit',9,12,0],
        [5,'08:45','09:30','HIIT',5,14,0],[5,'09:30','10:15','HYROX',12,12,1],
        [6,'09:00','09:45','Circuit',8,12,0],[6,'09:45','10:30','Circuit',4,12,0]
    ],
    Wekerom: [
        [1,'08:45','09:30','Pilates',6,12,0],[1,'09:00','09:45','Circuit',7,8,0],[1,'19:00','19:45','HYROX',10,10,0],[1,'20:00','20:45','Circuit',12,12,0],
        [2,'09:00','10:00','CLUBS',6,8,0],[2,'19:00','20:00','Circuit',7,10,0],
        [3,'09:00','10:00','BBB Strength',4,8,0],[3,'18:00','18:45','Pilates',13,12,0],[3,'19:00','19:45','HYROX',5,6,0],[3,'20:00','20:45','Boksfit',7,12,0],
        [4,'09:00','10:00','Workout of the Day',3,8,0],[4,'19:00','19:45','Kracht',5,8,0],
        [5,'09:00','10:00','Circuit',4,8,0],[6,'08:45','09:45','Kracht',8,8,0]
    ],
    Harskamp: []
};

const form = document.getElementById('staffing-filter-form');
const fromFilter = document.getElementById('from-filter');
const toFilter = document.getElementById('to-filter');
const locationFilter = document.getElementById('location-filter');
const statusFilter = document.getElementById('status-filter');
const summary = document.getElementById('staffing-summary');
const results = document.getElementById('staffing-results');
const resultCount = document.getElementById('staffing-result-count');
let rosterItems = [];

function timeToMinutes(value){const [h,m]=String(value||'').split(':').map(Number);return Number.isFinite(h)&&Number.isFinite(m)?h*60+m:null}
function minutesToTime(value){return `${String(Math.floor(value/60)).padStart(2,'0')}:${String(value%60).padStart(2,'0')}`}
function isoDate(date){return [date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-')}
function parseDate(value){const [y,m,d]=value.split('-').map(Number);return new Date(y,m-1,d)}
function addDays(value,days){const date=parseDate(value);date.setDate(date.getDate()+days);return isoDate(date)}
function escapeHtml(value){return String(value??'').replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#039;')}
function formatDate(value){return new Intl.DateTimeFormat('nl-NL',{weekday:'short',day:'2-digit',month:'2-digit',year:'numeric'}).format(parseDate(value))}

function getLessons(location,dateString){
    const day=parseDate(dateString).getDay();
    return (LESSON_TEMPLATES[location]||[]).filter(item=>item[0]===day).map(item=>({
        name:item[3],start:item[1],end:item[2],registered:item[4],capacity:item[5],waitlist:item[6],source:'historical-template'
    }));
}

function getShiftEmployees(location,dateString,start,end){
    const names=new Set();
    rosterItems.filter(item=>item.itemType==='shift'&&item.location===location&&item.rosterDate===dateString).forEach(item=>{
        const shiftStart=timeToMinutes(item.startTime);const shiftEnd=timeToMinutes(item.endTime);
        if(shiftStart===null||shiftEnd===null)return;
        const normalizedEnd=shiftEnd<=shiftStart?shiftEnd+1440:shiftEnd;
        if(shiftStart<end&&normalizedEnd>start)names.add(item.employeeName);
    });
    return [...names];
}

function getRuleState(location,dateString,start,end,activeLessons){
    const date=parseDate(dateString);const day=date.getDay();const month=date.getMonth()+1;
    const isEveningPeak=day>=1&&day<=4&&start<21*60+30&&end>18*60;
    let hardMinimum=isEveningPeak?2:1;
    let advisedMinimum=hardMinimum;
    const reasons=[];
    if(isEveningPeak)reasons.push('Harde avondnorm: maandag t/m donderdag 18:00–21:30 minimaal 2 medewerkers.');

    if(activeLessons.length){
        const lessonNames=activeLessons.map(lesson=>lesson.name).join(', ');
        reasons.push(`Reguliere groepsles actief: ${lessonNames}.`);
        if(location==='Voorthuizen'){
            const tuesdayMorning=day===2&&start<12*60;
            const summer=month===7||month===8;
            if(tuesdayMorning){reasons.push('Uitzondering Voorthuizen: dinsdagochtend mag enkel bezet zijn.');}
            else if(summer){reasons.push('Juli/augustus: dubbele bezetting bij lessen is geen harde norm.');advisedMinimum=Math.max(advisedMinimum,2);}
            else{hardMinimum=Math.max(hardMinimum,2);advisedMinimum=Math.max(advisedMinimum,2);reasons.push('Voorthuizen: aparte groepslesruimte, buiten juli/augustus minimaal 2 medewerkers.');}
        }
        if(location==='Barneveld'){
            advisedMinimum=Math.max(advisedMinimum,2);
            reasons.push('Barneveld: aparte groepslesruimte; dubbele bezetting is een sterk advies.');
        }
        if(activeLessons.length>1){
            advisedMinimum=Math.max(advisedMinimum,activeLessons.length+1);
            reasons.push(`${activeLessons.length} lessen overlappen; extra operationele capaciteit overwegen.`);
        }
        const highDemand=activeLessons.some(lesson=>lesson.waitlist>0||lesson.registered>=lesson.capacity||lesson.registered>=10);
        if(highDemand)reasons.push('Hoge lesdruk: volle les, wachtlijst of minimaal 10 deelnemers.');
    }
    return {hardMinimum,advisedMinimum,reasons,isEveningPeak};
}

function analyzeDateLocation(dateString,location){
    const lessons=getLessons(location,dateString);
    const boundaries=new Set();
    const day=parseDate(dateString).getDay();
    if(day>=1&&day<=4){boundaries.add(18*60);boundaries.add(21*60+30)}
    lessons.forEach(lesson=>{boundaries.add(timeToMinutes(lesson.start));boundaries.add(timeToMinutes(lesson.end))});
    rosterItems.filter(item=>item.itemType==='shift'&&item.location===location&&item.rosterDate===dateString).forEach(item=>{
        const start=timeToMinutes(item.startTime);const end=timeToMinutes(item.endTime);if(start!==null)boundaries.add(start);if(end!==null)boundaries.add(end);
    });
    const sorted=[...boundaries].filter(Number.isFinite).sort((a,b)=>a-b);
    const rows=[];
    for(let index=0;index<sorted.length-1;index+=1){
        const start=sorted[index],end=sorted[index+1];if(end<=start)continue;
        const activeLessons=lessons.filter(lesson=>timeToMinutes(lesson.start)<end&&timeToMinutes(lesson.end)>start);
        const relevant=(day>=1&&day<=4&&start<21*60+30&&end>18*60)||activeLessons.length>0;
        if(!relevant)continue;
        const employees=getShiftEmployees(location,dateString,start,end);
        const rule=getRuleState(location,dateString,start,end,activeLessons);
        let status='sufficient';
        if(employees.length<rule.hardMinimum)status='under';
        else if(employees.length<rule.advisedMinimum)status='vulnerable';
        else if(activeLessons.some(lesson=>lesson.waitlist>0||lesson.registered>=lesson.capacity))status='vulnerable';
        rows.push({date:dateString,location,start,end,employees,activeLessons,status,...rule});
    }
    return rows;
}

function analyze(){
    const from=fromFilter.value;const to=toFilter.value;if(!from||!to||from>to)return [];
    const selectedLocations=locationFilter.value?[locationFilter.value]:LOCATIONS;
    const rows=[];let cursor=from;
    while(cursor<=to){selectedLocations.forEach(location=>rows.push(...analyzeDateLocation(cursor,location)));cursor=addDays(cursor,1)}
    const mode=statusFilter.value;
    return rows.filter(row=>mode==='all'||(mode==='issues'&&row.status!=='sufficient')||row.status===mode);
}

function renderSummary(allRows){
    const under=allRows.filter(row=>row.status==='under').length;
    const vulnerable=allRows.filter(row=>row.status==='vulnerable').length;
    const sufficient=allRows.filter(row=>row.status==='sufficient').length;
    const missingHours=allRows.filter(row=>row.status==='under').reduce((total,row)=>total+(row.end-row.start)/60,0);
    summary.innerHTML=`
        <article class="summary-card is-danger"><span class="summary-value">${under}</span><span class="summary-label">Onderbezette tijdsblokken</span></article>
        <article class="summary-card is-warning"><span class="summary-value">${vulnerable}</span><span class="summary-label">Kwetsbare tijdsblokken</span></article>
        <article class="summary-card is-ok"><span class="summary-value">${sufficient}</span><span class="summary-label">Voldoende bezet</span></article>
        <article class="summary-card"><span class="summary-value">${missingHours.toFixed(1)}</span><span class="summary-label">Uren onder harde norm</span></article>`;
}

function renderRows(rows){
    resultCount.textContent=`${rows.length} tijdsblok(ken)`;
    if(!rows.length){results.innerHTML='<p class="empty-state">Geen tijdsblokken gevonden voor deze selectie.</p>';return}
    results.innerHTML=rows.map(row=>{
        const lessonText=row.activeLessons.length?row.activeLessons.map(lesson=>`${lesson.name} ${lesson.registered}/${lesson.capacity}${lesson.waitlist?` +${lesson.waitlist} wachtlijst`:''}`).join(' · '):'Geen groepsles';
        const label=row.status==='under'?'Onderbezet':row.status==='vulnerable'?'Kwetsbaar':'Voldoende';
        return `<article class="staffing-row is-${row.status}">
            <div class="staffing-date"><strong>${escapeHtml(formatDate(row.date))}</strong><span class="muted">${WEEKDAYS[parseDate(row.date).getDay()]}</span></div>
            <div class="staffing-location"><strong>${escapeHtml(row.location)}</strong><span class="muted">${escapeHtml(lessonText)}</span></div>
            <div><strong>${minutesToTime(row.start)}–${minutesToTime(row.end)}</strong><span class="muted">${row.employees.length?escapeHtml(row.employees.join(', ')):'Niemand ingepland'}</span></div>
            <div><strong>${row.employees.length}</strong><span class="muted">ingepland</span></div>
            <div><strong>${row.hardMinimum}</strong><span class="muted">harde norm${row.advisedMinimum>row.hardMinimum?` / advies ${row.advisedMinimum}`:''}</span></div>
            <div class="staffing-reason"><span class="status-pill is-${row.status}">${label}</span><ul>${row.reasons.map(reason=>`<li>${escapeHtml(reason)}</li>`).join('')}</ul></div>
        </article>`
    }).join('');
}

function runAnalysis(){
    const allMode=statusFilter.value;statusFilter.value='all';const allRows=analyze();statusFilter.value=allMode;
    renderSummary(allRows);renderRows(analyze());
}

async function init(){
    try{
        const response=await fetch('/api/roster');if(!response.ok)throw new Error('Rooster kon niet worden geladen.');
        rosterItems=await response.json();
        const dates=rosterItems.map(item=>item.rosterDate).filter(Boolean).sort();
        const latest=dates.at(-1)||isoDate(new Date());
        toFilter.value=latest;fromFilter.value=addDays(latest,-6);
        runAnalysis();
    }catch(error){results.innerHTML=`<p class="error-state">${escapeHtml(error.message)}</p>`;resultCount.textContent='Fout';}
}

form.addEventListener('submit',event=>{event.preventDefault();runAnalysis()});
init();
