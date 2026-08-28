(() => {
  "use strict";

  const STORAGE_KEY = "floraEnglishPlayer.v1";
  const DB_NAME = "FloraEnglishPlayerDB";
  const DB_VERSION = 1;
  const RECORDING_STORE = "recordings";

  const $ = (s) => document.querySelector(s);
  const $$ = (s) => [...document.querySelectorAll(s)];
  const uid = () => (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}_${Math.random().toString(16).slice(2)}`);

  const defaultState = {
    playlists: [{
      id: uid(),
      name: "기본 플레이리스트",
      description: "",
      sentences: [{
        id: uid(), order: 1, lesson: "DAY 001",
        english: "How long have you had this phone?",
        korean: "이 휴대폰을 얼마나 오래 사용했어요?",
        grammar: "현재완료",
        structure: "How long have you + 과거분사",
        words: [
          {word:"have", meaning:"가지고 있다", pronunciation:"/hæv/", pos:"동사"}
        ],
        memo: "", review: false, completed: false, lastStudiedAt: null
      }]
    }],
    currentPlaylistId: null,
    currentSentenceId: null,
    currentIndex: 0,
    playMode: "sequence",
    reviewOnly: false,
    selectedSentenceIds: [],
    settings: {
      repeat: "3", delay: "5", speed: "0.8", language: "EN_KR",
      displayMode: "both", autoRecord: false, recordDuration: "5", autoNext: true
    }
  };

  let state = loadState();
  if (!state.currentPlaylistId && state.playlists[0]) state.currentPlaylistId = state.playlists[0].id;
  if (!state.currentSentenceId && state.playlists[0]?.sentences[0]) state.currentSentenceId = state.playlists[0].sentences[0].id;

  let session = {
    stopRequested: false, paused: false, playing: false, timer: null,
    mediaRecorder: null, mediaStream: null, chunks: [], recordingStartedAt: 0,
    fileHandle: null, folderHandle: null, currentPlayQueue: null
  };

  const els = {
    views: $$(".view"), navBtns: $$(".nav-btn"),
    currentPlaylistName: $("#currentPlaylistName"), sentenceCounter: $("#sentenceCounter"),
    favoriteBtn: $("#favoriteBtn"), englishText: $("#englishText"), koreanText: $("#koreanText"),
    detailsBox: $("#detailsBox"), structureText: $("#structureText"), grammarText: $("#grammarText"), wordsText: $("#wordsText"),
    playStatus: $("#playStatus"), timerText: $("#timerText"), countdownArea: $("#countdownArea"), countdownNumber: $("#countdownNumber"), countdownLabel: $("#countdownLabel"),
    repeatSelect: $("#repeatSelect"), delaySelect: $("#delaySelect"), speedSelect: $("#speedSelect"), languageSelect: $("#languageSelect"),
    autoRecordToggle: $("#autoRecordToggle"), recordDurationSelect: $("#recordDurationSelect"),
    playlistCards: $("#playlistCards"), playlistDetail: $("#playlistDetail"), detailPlaylistName: $("#detailPlaylistName"),
    detailTotal: $("#detailTotal"), sentenceList: $("#sentenceList"), sortSelect: $("#sortSelect"), playModeSelect: $("#playModeSelect"),
    selectedCount: $("#selectedCount"), recordingList: $("#recordingList"), recordingCount: $("#recordingCount"), recordingSize: $("#recordingSize"),
    recordingSelectionBar: $("#recordingSelectionBar"), recordingSelectedCount: $("#recordingSelectedCount"),
    playlistDialog: $("#playlistDialog"), sentenceDialog: $("#sentenceDialog"), settingsDialog: $("#settingsDialog"), toast: $("#toast")
  };

  init();

  function init() {
    for (let i=1;i<=10;i++) els.delaySelect.insertAdjacentHTML("beforeend", `<option value="${i}">${i}초</option>`);
    for (let i=5;i<=10;i++) {
      const v = (i/10).toFixed(1);
      els.speedSelect.insertAdjacentHTML("beforeend", `<option value="${v}">${v}</option>`);
    }
    hydrateSettings();
    bindEvents();
    renderAll();
    openDB().then(renderRecordings).catch(console.error);
  }

  function loadState() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return structuredCloneSafe(defaultState);
      const parsed = JSON.parse(raw);
      return mergeState(structuredCloneSafe(defaultState), parsed);
    } catch {
      return structuredCloneSafe(defaultState);
    }
  }
  function structuredCloneSafe(obj){ return JSON.parse(JSON.stringify(obj)); }
  function mergeState(base, saved) {
    return {
      ...base, ...saved,
      settings: {...base.settings, ...(saved.settings||{})},
      playlists: Array.isArray(saved.playlists) ? saved.playlists : base.playlists
    };
  }
  function saveState() {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  }

  function currentPlaylist() {
    return state.playlists.find(p => p.id === state.currentPlaylistId) || state.playlists[0] || null;
  }
  function sortedSentences(playlist = currentPlaylist()) {
    if (!playlist) return [];
    let list = [...playlist.sentences];
    const sort = els.sortSelect?.value || "order";
    if (sort === "name") list.sort((a,b)=>a.english.localeCompare(b.english));
    if (sort === "nameDesc") list.sort((a,b)=>b.english.localeCompare(a.english));
    if (sort === "lesson") list.sort((a,b)=>(a.lesson||"").localeCompare(b.lesson||"") || a.order-b.order);
    if (sort === "review") list.sort((a,b)=>Number(b.review)-Number(a.review) || a.order-b.order);
    else if (sort === "order") list.sort((a,b)=>a.order-b.order);
    return list;
  }
  function currentSentence() {
    const p = currentPlaylist();
    if (!p) return null;
    return p.sentences.find(s => s.id === state.currentSentenceId) || p.sentences[state.currentIndex] || p.sentences[0] || null;
  }

  function renderAll() {
    renderStudy();
    renderPlaylists();
    if (!els.playlistDetail.classList.contains("hidden")) renderPlaylistDetail();
  }

  function renderStudy() {
    const p = currentPlaylist();
    const s = currentSentence();
    els.currentPlaylistName.textContent = p?.name || "플레이리스트 없음";

    if (!p || !s) {
      els.sentenceCounter.textContent = "0 / 0";
      els.englishText.textContent = "플레이리스트에서 문장을 추가해 주세요.";
      els.koreanText.textContent = "";
      els.detailsBox.classList.add("hidden");
      els.favoriteBtn.textContent = "☆";
      return;
    }

    const idx = p.sentences.findIndex(x=>x.id===s.id);
    state.currentIndex = idx >= 0 ? idx : 0;
    els.sentenceCounter.textContent = `${state.currentIndex+1} / ${p.sentences.length}`;
    els.englishText.textContent = s.english || "";
    els.koreanText.textContent = s.korean || "";
    els.favoriteBtn.textContent = s.review ? "★" : "☆";
    els.favoriteBtn.classList.toggle("active", !!s.review);

    const mode = state.settings.displayMode;
    els.englishText.classList.toggle("hidden", mode === "kr");
    els.koreanText.classList.toggle("hidden", mode === "en" || !s.korean);
    $$(".display-mode").forEach(b=>b.classList.toggle("active", b.dataset.mode===mode));

    els.structureText.textContent = s.structure || "등록된 정보 없음";
    els.grammarText.textContent = s.grammar || "등록된 정보 없음";
    const validWords = (s.words||[]).filter(w=>w.word || w.meaning || w.pronunciation || w.pos);
    els.wordsText.innerHTML = validWords.length ? validWords.map(w => `
      <div class="word-row">
        <div class="word-main">${escapeHtml(w.word||"")}${w.meaning ? ` · ${escapeHtml(w.meaning)}` : ""}</div>
        <div class="word-meta">${[w.pronunciation,w.pos].filter(Boolean).map(escapeHtml).join(" · ")}</div>
      </div>`).join("") : `<div class="detail-content">등록된 정보 없음</div>`;
    els.detailsBox.classList.toggle("hidden", !(s.structure || s.grammar || validWords.length));
  }

  function renderPlaylists() {
    els.playlistCards.innerHTML = state.playlists.length ? state.playlists.map(p=>{
      const reviewCount = p.sentences.filter(s=>s.review).length;
      const currentIdx = p.id===state.currentPlaylistId ? Math.max(0,p.sentences.findIndex(s=>s.id===state.currentSentenceId))+1 : 0;
      return `<article class="playlist-card" data-playlist-id="${p.id}">
        <button class="play-mini" data-action="play-playlist">▶</button>
        <div class="card-main" data-action="open-playlist">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="playlist-meta"><span>${Math.min(currentIdx,p.sentences.length)} / ${p.sentences.length}</span><span>${state.settings.speed}x</span><span>★ ${reviewCount}</span></div>
        </div>
        <button class="menu" data-action="playlist-menu">⋮</button>
      </article>`;
    }).join("") : `<p class="muted">플레이리스트가 없습니다.</p>`;
  }

  function renderPlaylistDetail() {
    const p = currentPlaylist();
    if (!p) return;
    els.detailPlaylistName.textContent = p.name;
    els.detailTotal.textContent = `총 ${p.sentences.length}개`;

    let list = sortedSentences(p);
    if (state.reviewOnly) list = list.filter(s=>s.review);

    els.sentenceList.innerHTML = list.length ? list.map((s,i)=>{
      const checked = state.selectedSentenceIds.includes(s.id);
      const stateIcon = s.review ? "★" : s.completed ? "✓" : "○";
      return `<div class="sentence-row" data-sentence-id="${s.id}">
        <input class="sentence-check" type="checkbox" ${checked?"checked":""} aria-label="문장 선택">
        <button class="play-one" data-action="play-one">▶</button>
        <div class="sentence-body" data-action="open-sentence">
          <div class="en">${escapeHtml(s.english||"")}</div>
          ${s.korean ? `<div class="kr">${escapeHtml(s.korean)}</div>`:""}
        </div>
        <button class="state" data-action="toggle-review" aria-label="복습">${stateIcon}</button>
      </div>`;
    }).join("") : `<p class="muted">표시할 문장이 없습니다.</p>`;

    els.selectedCount.textContent = `${state.selectedSentenceIds.length}개 선택`;
  }

  function hydrateSettings() {
    els.repeatSelect.value = state.settings.repeat;
    els.delaySelect.value = state.settings.delay;
    els.speedSelect.value = state.settings.speed;
    els.languageSelect.value = state.settings.language;
    els.autoRecordToggle.checked = !!state.settings.autoRecord;
    els.recordDurationSelect.value = state.settings.recordDuration;
    $("#autoNextToggle").checked = !!state.settings.autoNext;
  }

  function bindEvents() {
    els.navBtns.forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));
    $("#settingsBtn").addEventListener("click",()=>els.settingsDialog.showModal());
    $("#addPlaylistBtn").addEventListener("click",()=>els.playlistDialog.showModal());
    $("#closePlaylistDetail").addEventListener("click",()=>els.playlistDetail.classList.add("hidden"));
    $("#addSentenceBtn").addEventListener("click",()=>openSentenceDialog());
    $("#editSentenceBtn").addEventListener("click",()=>openSentenceDialog(currentSentence()));

    $$(".display-mode").forEach(btn=>btn.addEventListener("click",()=>{
      state.settings.displayMode = btn.dataset.mode; saveState(); renderStudy();
    }));

    els.favoriteBtn.addEventListener("click",()=>toggleReview(currentSentence()?.id));
    $("#prevBtn").addEventListener("click",()=>moveSentence(-1));
    $("#nextBtn").addEventListener("click",()=>moveSentence(1));
    $("#playBtn").addEventListener("click",()=>startPractice());
    $("#pauseBtn").addEventListener("click",togglePause);
    $("#stopBtn").addEventListener("click",stopEverything);
    $("#recordBtn").addEventListener("click",toggleManualRecording);

    [els.repeatSelect,els.delaySelect,els.speedSelect,els.languageSelect,els.recordDurationSelect].forEach(el=>{
      el.addEventListener("change",()=>{
        state.settings.repeat=els.repeatSelect.value;
        state.settings.delay=els.delaySelect.value;
        state.settings.speed=els.speedSelect.value;
        state.settings.language=els.languageSelect.value;
        state.settings.recordDuration=els.recordDurationSelect.value;
        saveState(); renderPlaylists();
      });
    });
    els.autoRecordToggle.addEventListener("change",()=>{state.settings.autoRecord=els.autoRecordToggle.checked;saveState()});
    $("#autoNextToggle").addEventListener("change",()=>{state.settings.autoNext=$("#autoNextToggle").checked;saveState()});

    els.playlistCards.addEventListener("click", handlePlaylistCardClick);
    els.sentenceList.addEventListener("click", handleSentenceListClick);
    els.sentenceList.addEventListener("change", handleSentenceCheck);

    els.sortSelect.addEventListener("change",renderPlaylistDetail);
    els.playModeSelect.addEventListener("change",()=>{state.playMode=els.playModeSelect.value;saveState()});
    $("#reviewOnlyBtn").addEventListener("click",()=>{state.reviewOnly=!state.reviewOnly;renderPlaylistDetail();toast(state.reviewOnly?"복습 문장만 표시합니다.":"전체 문장을 표시합니다.")});
    $("#playAllBtn").addEventListener("click",()=>startPlaylistPractice());
    $("#practiceSelectedBtn").addEventListener("click",()=>startSelectedPractice());

    $("#createPlaylistSubmit").addEventListener("click", createPlaylistFromDialog);
    $("#saveSentenceBtn").addEventListener("click", saveSentenceFromDialog);

    $("#chooseFolderBtn").addEventListener("click", chooseSaveFolder);
    els.recordingList.addEventListener("change", renderRecordingSelectionBar);
    els.recordingList.addEventListener("click", handleRecordingActions);
    $("#mergeBtn").addEventListener("click", mergeSelectedRecordings);
    $("#downloadSelectedBtn").addEventListener("click", downloadSelectedRecordings);
    $("#shareSelectedBtn").addEventListener("click", shareSelectedRecordings);
    $("#deleteSelectedBtn").addEventListener("click", deleteSelectedRecordings);

    $("#resetLocalDataBtn").addEventListener("click", async ()=>{
      if (!confirm("플레이리스트와 학습 상태를 초기화할까요? 녹음 파일은 별도로 유지됩니다.")) return;
      localStorage.removeItem(STORAGE_KEY);
      location.reload();
    });
  }

  function switchView(viewId) {
    els.views.forEach(v=>v.classList.toggle("active",v.id===viewId));
    els.navBtns.forEach(b=>b.classList.toggle("active",b.dataset.view===viewId));
    if (viewId==="recordingsView") renderRecordings();
  }

  function handlePlaylistCardClick(e) {
    const card = e.target.closest(".playlist-card");
    if (!card) return;
    const p = state.playlists.find(x=>x.id===card.dataset.playlistId);
    if (!p) return;

    if (e.target.closest('[data-action="playlist-menu"]')) {
      const action = prompt(`"${p.name}" 관리\n1: 이름 변경\n2: 삭제`, "1");
      if (action==="1") {
        const name = prompt("새 이름", p.name);
        if (name?.trim()) { p.name=name.trim(); saveState(); renderAll(); }
      } else if (action==="2" && confirm("플레이리스트를 삭제할까요?")) {
        state.playlists = state.playlists.filter(x=>x.id!==p.id);
        if (state.currentPlaylistId===p.id) {
          state.currentPlaylistId=state.playlists[0]?.id||null;
          state.currentSentenceId=state.playlists[0]?.sentences[0]?.id||null;
        }
        saveState(); renderAll();
      }
      return;
    }

    state.currentPlaylistId=p.id;
    state.currentSentenceId=p.sentences[0]?.id||null;
    state.currentIndex=0;
    saveState();

    if (e.target.closest('[data-action="play-playlist"]')) {
      switchView("studyView"); renderStudy(); startPlaylistPractice();
    } else {
      state.reviewOnly=false; state.selectedSentenceIds=[];
      els.playlistDetail.classList.remove("hidden"); renderPlaylistDetail(); renderStudy();
    }
  }

  function handleSentenceListClick(e) {
    const row = e.target.closest(".sentence-row");
    if (!row) return;
    const id = row.dataset.sentenceId;

    if (e.target.closest('[data-action="toggle-review"]')) { toggleReview(id); return; }
    if (e.target.closest('[data-action="play-one"]')) {
      const s=currentPlaylist()?.sentences.find(x=>x.id===id); if(s) speakText(s.english,"en-US");
      return;
    }
    if (e.target.closest('[data-action="open-sentence"]')) {
      state.currentSentenceId=id; saveState(); renderStudy(); switchView("studyView");
    }
  }

  function handleSentenceCheck(e) {
    if (!e.target.classList.contains("sentence-check")) return;
    const id=e.target.closest(".sentence-row").dataset.sentenceId;
    if (e.target.checked) {
      if (!state.selectedSentenceIds.includes(id)) state.selectedSentenceIds.push(id);
    } else state.selectedSentenceIds=state.selectedSentenceIds.filter(x=>x!==id);
    saveState(); renderPlaylistDetail();
  }

  function toggleReview(id) {
    if (!id) return;
    for (const p of state.playlists) {
      const s=p.sentences.find(x=>x.id===id);
      if (s) { s.review=!s.review; break; }
    }
    saveState(); renderAll();
  }

  function moveSentence(delta) {
    const p=currentPlaylist(); if(!p?.sentences.length)return;
    let idx=p.sentences.findIndex(s=>s.id===state.currentSentenceId);
    idx=(idx+delta+p.sentences.length)%p.sentences.length;
    state.currentSentenceId=p.sentences[idx].id; state.currentIndex=idx; saveState(); renderStudy();
  }

  function createPlaylistFromDialog(e) {
    e.preventDefault();
    const name=$("#playlistNameInput").value.trim();
    if(!name){toast("플레이리스트 이름을 입력해 주세요.");return;}
    const p={id:uid(),name,description:"",sentences:[]};
    const file=$("#importFileInput").files[0];
    state.playlists.push(p);
    state.currentPlaylistId=p.id;
    state.currentSentenceId=null;
    saveState();

    if(file) {
      importFileToPlaylist(file,p).then(()=>{
        state.currentSentenceId=p.sentences[0]?.id||null; saveState(); renderAll();
        els.playlistDialog.close(); $("#playlistForm").reset(); toast(`${p.sentences.length}개 문장을 가져왔습니다.`);
      }).catch(err=>{console.error(err);toast("파일을 읽지 못했습니다.");});
    } else {
      els.playlistDialog.close(); $("#playlistForm").reset(); renderAll(); toast("플레이리스트를 추가했습니다.");
    }
  }

  async function importFileToPlaylist(file,p) {
    const text=await file.text();
    if(file.name.toLowerCase().endsWith(".txt")) {
      p.sentences=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((english,i)=>newSentence({english,order:i+1}));
      return;
    }
    if(file.name.toLowerCase().endsWith(".csv")) {
      const rows=parseCSV(text); if(!rows.length)return;
      const headers=rows[0].map(h=>h.trim().toUpperCase());
      p.sentences=rows.slice(1).filter(r=>r.some(Boolean)).map((r,i)=>{
        const v=(name)=>r[headers.indexOf(name)]??"";
        return newSentence({
          order:Number(v("ORDER"))||i+1, lesson:v("LESSON"), english:v("ENGLISH"), korean:v("KOREAN"),
          grammar:v("GRAMMAR"), structure:v("STRUCTURE"),
          words:[
            {word:v("WORD_1"),meaning:v("WORD_1_MEANING"),pronunciation:v("WORD_1_PRONUNCIATION"),pos:v("WORD_1_POS")},
            {word:v("WORD_2"),meaning:v("WORD_2_MEANING"),pronunciation:v("WORD_2_PRONUNCIATION"),pos:v("WORD_2_POS")}
          ]
        });
      }).filter(s=>s.english);
      return;
    }
    throw new Error("unsupported file");
  }

  function parseCSV(text) {
    const rows=[]; let row=[], field="", quoted=false;
    for(let i=0;i<text.length;i++){
      const c=text[i], n=text[i+1];
      if(c==='"' && quoted && n==='"'){field+='"';i++;continue;}
      if(c==='"'){quoted=!quoted;continue;}
      if(c===","&&!quoted){row.push(field);field="";continue;}
      if((c==="\n"||c==="\r")&&!quoted){
        if(c==="\r"&&n==="\n")i++;
        row.push(field); rows.push(row); row=[]; field=""; continue;
      }
      field+=c;
    }
    if(field.length||row.length){row.push(field);rows.push(row);}
    return rows;
  }

  function newSentence(data={}) {
    return {
      id:uid(),order:data.order||1,lesson:data.lesson||"",english:data.english||"",korean:data.korean||"",
      grammar:data.grammar||"",structure:data.structure||"",words:data.words||[],memo:data.memo||"",
      review:false,completed:false,lastStudiedAt:null
    };
  }

  function openSentenceDialog(s=null) {
    $("#sentenceDialogTitle").textContent=s?"문장 수정":"문장 추가";
    $("#editingSentenceId").value=s?.id||"";
    $("#lessonInput").value=s?.lesson||"";
    $("#englishInput").value=s?.english||"";
    $("#koreanInput").value=s?.korean||"";
    $("#grammarInput").value=s?.grammar||"";
    $("#structureInput").value=s?.structure||"";
    const w=s?.words||[];
    $("#word1Input").value=w[0]?.word||""; $("#word1MeaningInput").value=w[0]?.meaning||"";
    $("#word1PronunciationInput").value=w[0]?.pronunciation||""; $("#word1PosInput").value=w[0]?.pos||"";
    $("#word2Input").value=w[1]?.word||""; $("#word2MeaningInput").value=w[1]?.meaning||"";
    $("#word2PronunciationInput").value=w[1]?.pronunciation||""; $("#word2PosInput").value=w[1]?.pos||"";
    $("#memoInput").value=s?.memo||"";
    els.sentenceDialog.showModal();
  }

  function saveSentenceFromDialog(e) {
    e.preventDefault();
    const p=currentPlaylist(); if(!p){toast("먼저 플레이리스트를 만들어 주세요.");return;}
    const id=$("#editingSentenceId").value;
    let s=p.sentences.find(x=>x.id===id);
    if(!s){s=newSentence({order:p.sentences.length+1});p.sentences.push(s);}
    s.lesson=$("#lessonInput").value.trim(); s.english=$("#englishInput").value.trim(); s.korean=$("#koreanInput").value.trim();
    s.grammar=$("#grammarInput").value.trim(); s.structure=$("#structureInput").value.trim(); s.memo=$("#memoInput").value.trim();
    s.words=[
      {word:$("#word1Input").value.trim(),meaning:$("#word1MeaningInput").value.trim(),pronunciation:$("#word1PronunciationInput").value.trim(),pos:$("#word1PosInput").value.trim()},
      {word:$("#word2Input").value.trim(),meaning:$("#word2MeaningInput").value.trim(),pronunciation:$("#word2PronunciationInput").value.trim(),pos:$("#word2PosInput").value.trim()}
    ];
    state.currentSentenceId=s.id; saveState(); els.sentenceDialog.close(); renderAll(); toast("문장을 저장했습니다.");
  }

  async function startPractice(queue=null) {
    if(session.playing){toast("이미 재생 중입니다.");return;}
    const s=currentSentence(); if(!s)return;
    session.stopRequested=false; session.paused=false; session.playing=true;
    session.currentPlayQueue=queue;
    try { await practiceSentence(s); }
    catch(err){ if(err?.message!=="STOP") console.error(err); }
    finally { session.playing=false; setStatus("준비"); session.currentPlayQueue=null; }
  }

  async function practiceSentence(s) {
    const repeat = state.settings.repeat==="infinite" ? Infinity : Number(state.settings.repeat);
    let count=0;
    while(count<repeat && !session.stopRequested) {
      count++;
      const lang=state.settings.language;
      if(lang==="EN") await speakText(s.english,"en-US");
      if(lang==="KR") await speakText(s.korean,"ko-KR");
      if(lang==="EN_KR"){ await speakText(s.english,"en-US"); if(s.korean) await speakText(s.korean,"ko-KR"); }
      if(lang==="KR_EN"){ if(s.korean) await speakText(s.korean,"ko-KR"); await speakText(s.english,"en-US"); }
      if(session.stopRequested) throw new Error("STOP");

      if(state.settings.autoRecord) {
        setStatus("🎤 녹음 중");
        const duration=state.settings.recordDuration;
        await startRecording(duration==="manual"?null:Number(duration)*1000, s);
      }

      if(count<repeat || repeat===Infinity) {
        await countdown(Number(state.settings.delay));
      }
    }
    s.completed=true; s.lastStudiedAt=Date.now(); saveState(); renderAll();

    if(state.settings.autoNext && repeat!==Infinity && !session.stopRequested && !session.currentPlayQueue) {
      moveSentence(1);
    }
  }

  async function startPlaylistPractice() {
    const p=currentPlaylist(); if(!p?.sentences.length)return;
    let list=sortedSentences(p); if(state.reviewOnly)list=list.filter(s=>s.review);
    if(state.playMode==="shuffle" || els.playModeSelect.value==="shuffle") list=shuffle([...list]);
    await runQueue(list);
  }

  async function startSelectedPractice() {
    const p=currentPlaylist(); if(!p)return;
    let list=sortedSentences(p).filter(s=>state.selectedSentenceIds.includes(s.id));
    if(!list.length){toast("연습할 문장을 선택해 주세요.");return;}
    if(state.playMode==="shuffle" || els.playModeSelect.value==="shuffle") list=shuffle(list);
    switchView("studyView"); await runQueue(list);
  }

  async function runQueue(list) {
    if(session.playing)return;
    session.playing=true; session.stopRequested=false; session.currentPlayQueue=list;
    try {
      for(const s of list) {
        if(session.stopRequested)break;
        state.currentSentenceId=s.id; saveState(); renderStudy();
        await practiceSentence(s);
      }
    } catch(err){if(err?.message!=="STOP")console.error(err)}
    finally{session.playing=false;session.currentPlayQueue=null;setStatus("준비")}
  }

  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

  function speakText(text,lang) {
    return new Promise((resolve,reject)=>{
      if(!text){resolve();return;}
      if(session.stopRequested){reject(new Error("STOP"));return;}
      speechSynthesis.cancel();
      const u=new SpeechSynthesisUtterance(text);
      u.lang=lang; u.rate=Number(state.settings.speed)||0.8;
      u.onstart=()=>setStatus("🎧 재생 중");
      u.onend=()=>resolve();
      u.onerror=e=>{ if(session.stopRequested) reject(new Error("STOP")); else resolve(); };
      speechSynthesis.speak(u);
    });
  }

  function togglePause() {
    if(!session.playing)return;
    if(!session.paused){speechSynthesis.pause();session.paused=true;setStatus("Ⅱ 일시정지")}
    else{speechSynthesis.resume();session.paused=false;setStatus("🎧 재생 중")}
  }

  function stopEverything() {
    session.stopRequested=true; session.playing=false; session.currentPlayQueue=null;
    speechSynthesis.cancel();
    if(session.timer){clearTimeout(session.timer);session.timer=null;}
    if(session.mediaRecorder?.state==="recording") session.mediaRecorder.stop();
    els.countdownArea.classList.add("hidden"); setStatus("정지");
  }

  function countdown(seconds) {
    return new Promise((resolve,reject)=>{
      els.countdownArea.classList.remove("hidden"); els.countdownLabel.textContent="따라 말해보세요."; setStatus("⏱ 따라 말하기");
      let left=seconds; els.countdownNumber.textContent=left;
      const tick=()=>{
        if(session.stopRequested){els.countdownArea.classList.add("hidden");reject(new Error("STOP"));return;}
        if(left<=0){els.countdownArea.classList.add("hidden");resolve();return;}
        els.countdownNumber.textContent=left--;
        session.timer=setTimeout(tick,1000);
      }; tick();
    });
  }

  function setStatus(text){els.playStatus.textContent=text}

  async function toggleManualRecording() {
    if(session.mediaRecorder?.state==="recording"){session.mediaRecorder.stop();return;}
    await startRecording(null,currentSentence());
  }

  async function startRecording(durationMs=null,sentence=null) {
    if(session.mediaRecorder?.state==="recording")return;
    if(speechSynthesis.speaking) speechSynthesis.cancel();
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    session.mediaStream=stream; session.chunks=[];
    const options={};
    const preferred=["audio/webm;codecs=opus","audio/webm","audio/mp4"];
    const mime=preferred.find(x=>MediaRecorder.isTypeSupported?.(x));
    if(mime)options.mimeType=mime;
    const rec=new MediaRecorder(stream,options);
    session.mediaRecorder=rec;
    rec.ondataavailable=e=>{if(e.data.size)session.chunks.push(e.data)};
    const done=new Promise(resolve=>{
      rec.onstop=async()=>{
        const blob=new Blob(session.chunks,{type:rec.mimeType||"audio/webm"});
        stream.getTracks().forEach(t=>t.stop());
        const elapsed=Math.max(0,(Date.now()-session.recordingStartedAt)/1000);
        await addRecording({
          id:uid(),blob,mimeType:blob.type,createdAt:Date.now(),duration:elapsed,
          sentenceId:sentence?.id||null,english:sentence?.english||"직접 녹음",
          name:`sentence_${String((state.currentIndex||0)+1).padStart(3,"0")}_${dateStamp()}.${extensionFor(blob.type)}`
        });
        els.recordBtn.classList.remove("active"); setStatus("✓ 녹음 완료"); await renderRecordings(); resolve();
      };
    });
    session.recordingStartedAt=Date.now(); rec.start(); els.recordBtn.classList.add("active"); setStatus("🎤 녹음 중");
    if(durationMs){
      await sleep(durationMs);
      if(rec.state==="recording")rec.stop();
      await done;
    }
  }

  function sleep(ms){return new Promise(r=>setTimeout(r,ms))}
  function dateStamp(){const d=new Date();return `${d.getFullYear()}${pad(d.getMonth()+1)}${pad(d.getDate())}_${pad(d.getHours())}${pad(d.getMinutes())}`}
  function pad(n){return String(n).padStart(2,"0")}
  function extensionFor(mime){if(mime.includes("mp4"))return"m4a";if(mime.includes("wav"))return"wav";return"webm"}

  function openDB(){
    return new Promise((resolve,reject)=>{
      const req=indexedDB.open(DB_NAME,DB_VERSION);
      req.onupgradeneeded=()=>{const db=req.result;if(!db.objectStoreNames.contains(RECORDING_STORE))db.createObjectStore(RECORDING_STORE,{keyPath:"id"})};
      req.onsuccess=()=>resolve(req.result); req.onerror=()=>reject(req.error);
    });
  }
  async function withStore(mode,fn){
    const db=await openDB();
    return new Promise((resolve,reject)=>{
      const tx=db.transaction(RECORDING_STORE,mode), store=tx.objectStore(RECORDING_STORE);
      let result; try{result=fn(store)}catch(e){reject(e);return}
      tx.oncomplete=()=>resolve(result);tx.onerror=()=>reject(tx.error);
    });
  }
  async function addRecording(rec){await withStore("readwrite",s=>s.put(rec));}
  async function getRecording(id){
    const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(RECORDING_STORE).objectStore(RECORDING_STORE).get(id);r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error)});
  }
  async function getAllRecordings(){
    const db=await openDB();return new Promise((resolve,reject)=>{const r=db.transaction(RECORDING_STORE).objectStore(RECORDING_STORE).getAll();r.onsuccess=()=>resolve(r.result||[]);r.onerror=()=>reject(r.error)});
  }
  async function removeRecording(id){await withStore("readwrite",s=>s.delete(id));}

  async function renderRecordings() {
    const list=(await getAllRecordings()).sort((a,b)=>b.createdAt-a.createdAt);
    els.recordingCount.textContent=list.length;
    els.recordingSize.textContent=formatBytes(list.reduce((sum,r)=>sum+(r.blob?.size||0),0));
    els.recordingList.innerHTML=list.length ? list.map(r=>{
      const url=URL.createObjectURL(r.blob);
      return `<article class="recording-card" data-recording-id="${r.id}">
        <input class="recording-check" type="checkbox">
        <div class="recording-info">
          <div class="title">${escapeHtml(r.english||r.name)}</div>
          <div class="meta">${formatDate(r.createdAt)} · ${formatDuration(r.duration)} · ${formatBytes(r.blob.size)}</div>
          <audio controls src="${url}"></audio>
          <div class="recording-actions">
            <button data-record-action="rename">이름 변경</button>
            <button data-record-action="download">다운로드</button>
            <button data-record-action="share">공유</button>
            <button data-record-action="delete">삭제</button>
          </div>
        </div>
        <div></div>
      </article>`;
    }).join("") : `<p class="muted">아직 녹음 파일이 없습니다.</p>`;
    renderRecordingSelectionBar();
  }

  function selectedRecordingIds(){return $$(".recording-check:checked").map(x=>x.closest(".recording-card").dataset.recordingId)}
  function renderRecordingSelectionBar(){
    const n=selectedRecordingIds().length;
    els.recordingSelectionBar.classList.toggle("hidden",!n); els.recordingSelectedCount.textContent=`${n}개 선택됨`;
  }
  async function handleRecordingActions(e){
    const btn=e.target.closest("[data-record-action]"); if(!btn)return;
    const id=btn.closest(".recording-card").dataset.recordingId, rec=await getRecording(id); if(!rec)return;
    const action=btn.dataset.recordAction;
    if(action==="rename"){const name=prompt("파일 이름",rec.name);if(name?.trim()){rec.name=name.trim();await addRecording(rec);renderRecordings()}}
    if(action==="download")downloadBlob(rec.blob,rec.name);
    if(action==="share")shareRecording(rec);
    if(action==="delete"&&confirm("이 녹음을 삭제할까요?")){await removeRecording(id);renderRecordings()}
  }

  async function chooseSaveFolder(){
    if(!window.showDirectoryPicker){toast("이 브라우저는 폴더 직접 저장을 지원하지 않습니다. 다운로드 방식을 사용합니다.");return;}
    try{session.folderHandle=await window.showDirectoryPicker({mode:"readwrite"});toast("저장 폴더를 선택했습니다.")}catch{}
  }

  async function saveBlob(blob,name){
    if(session.folderHandle){
      try{const h=await session.folderHandle.getFileHandle(name,{create:true});const w=await h.createWritable();await w.write(blob);await w.close();toast("선택한 폴더에 저장했습니다.");return}catch(e){console.warn(e)}
    }
    downloadBlob(blob,name);
  }

  function downloadBlob(blob,name){const a=document.createElement("a");a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
  async function downloadSelectedRecordings(){for(const id of selectedRecordingIds()){const r=await getRecording(id);if(r)await saveBlob(r.blob,r.name)}}
  async function shareRecording(rec){
    const file=new File([rec.blob],rec.name,{type:rec.blob.type});
    if(navigator.share && (!navigator.canShare || navigator.canShare({files:[file]}))){
      try{await navigator.share({files:[file],title:"FLORA English Player"})}catch{}
    } else {downloadBlob(rec.blob,rec.name);toast("공유 기능을 지원하지 않아 파일을 다운로드했습니다.")}
  }
  async function shareSelectedRecordings(){
    const ids=selectedRecordingIds(), files=[];
    for(const id of ids){const r=await getRecording(id);if(r)files.push(new File([r.blob],r.name,{type:r.blob.type}))}
    if(navigator.share && (!navigator.canShare || navigator.canShare({files}))){
      try{await navigator.share({files,title:"FLORA English Player"})}catch{}
    } else {for(const f of files)downloadBlob(f,f.name);toast("공유 기능을 지원하지 않아 파일을 다운로드했습니다.")}
  }
  async function deleteSelectedRecordings(){
    const ids=selectedRecordingIds();if(!ids.length||!confirm(`${ids.length}개 녹음을 삭제할까요?`))return;
    for(const id of ids)await removeRecording(id);renderRecordings();
  }

  async function mergeSelectedRecordings(){
    const ids=selectedRecordingIds(); if(ids.length<2){toast("병합할 녹음을 2개 이상 선택해 주세요.");return;}
    toast("선택한 순서대로 녹음을 병합합니다.");
    try{
      const records=[];for(const id of ids)records.push(await getRecording(id));
      const audioCtx=new (window.AudioContext||window.webkitAudioContext)();
      const buffers=[];
      for(const r of records){const ab=await r.blob.arrayBuffer();buffers.push(await audioCtx.decodeAudioData(ab.slice(0)))}
      const channels=Math.max(...buffers.map(b=>b.numberOfChannels));
      const sampleRate=buffers[0].sampleRate;
      const normalized=[];
      for(const b of buffers){
        if(b.sampleRate!==sampleRate){throw new Error("녹음 샘플레이트가 달라 브라우저 병합을 할 수 없습니다.")}
        normalized.push(b);
      }
      const totalFrames=normalized.reduce((n,b)=>n+b.length,0);
      const merged=audioCtx.createBuffer(channels,totalFrames,sampleRate);
      let offset=0;
      for(const b of normalized){
        for(let ch=0;ch<channels;ch++){
          const src=b.getChannelData(Math.min(ch,b.numberOfChannels-1));
          merged.getChannelData(ch).set(src,offset);
        }
        offset+=b.length;
      }
      const wav=audioBufferToWav(merged);
      const blob=new Blob([wav],{type:"audio/wav"});
      const name=`FLORA_Practice_${dateStamp()}.wav`;
      await addRecording({id:uid(),blob,mimeType:"audio/wav",createdAt:Date.now(),duration:merged.duration,sentenceId:null,english:"병합 녹음",name});
      await saveBlob(blob,name); await audioCtx.close(); await renderRecordings(); toast("병합을 완료했습니다.");
    }catch(e){console.error(e);toast("이 브라우저에서는 선택한 녹음을 병합하지 못했습니다.")}
  }

  function audioBufferToWav(buffer){
    const numChannels=buffer.numberOfChannels, sampleRate=buffer.sampleRate, length=buffer.length;
    const bytesPerSample=2, blockAlign=numChannels*bytesPerSample, dataSize=length*blockAlign;
    const ab=new ArrayBuffer(44+dataSize), view=new DataView(ab);
    writeStr(view,0,"RIFF");view.setUint32(4,36+dataSize,true);writeStr(view,8,"WAVE");writeStr(view,12,"fmt ");
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,numChannels,true);view.setUint32(24,sampleRate,true);
    view.setUint32(28,sampleRate*blockAlign,true);view.setUint16(32,blockAlign,true);view.setUint16(34,16,true);
    writeStr(view,36,"data");view.setUint32(40,dataSize,true);
    let pos=44;
    for(let i=0;i<length;i++)for(let ch=0;ch<numChannels;ch++){
      let s=Math.max(-1,Math.min(1,buffer.getChannelData(ch)[i]));s=s<0?s*0x8000:s*0x7fff;view.setInt16(pos,s,true);pos+=2;
    }
    return ab;
  }
  function writeStr(view,offset,s){for(let i=0;i<s.length;i++)view.setUint8(offset+i,s.charCodeAt(i))}

  function formatBytes(n){if(!n)return"0 MB";return n<1024*1024?`${(n/1024).toFixed(1)} KB`:`${(n/1024/1024).toFixed(1)} MB`}
  function formatDuration(sec){sec=Math.round(sec||0);return `${pad(Math.floor(sec/60))}:${pad(sec%60)}`}
  function formatDate(ts){const d=new Date(ts);return `${d.getMonth()+1}월 ${d.getDate()}일 ${d.getHours()<12?"오전":"오후"} ${d.getHours()%12||12}:${pad(d.getMinutes())}`}
  function escapeHtml(v){return String(v??"").replace(/[&<>"']/g,m=>({"&":"&amp;","<":"&lt;",">":"&gt;",'"':"&quot;","'":"&#039;"}[m]))}
  function toast(msg){els.toast.textContent=msg;els.toast.classList.add("show");clearTimeout(toast.t);toast.t=setTimeout(()=>els.toast.classList.remove("show"),2200)}
})();