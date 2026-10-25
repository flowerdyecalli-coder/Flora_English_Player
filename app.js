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
    selectedLessons: [],
    selectedNumber: "", selectedNumbers: [],
    settings: {
      repeat: "3", delay: "5", speed: "0.8", language: "EN_KR",
      displayMode: "both", autoRecord: false, recordDuration: "5", autoNext: true
    }
  };

  let state = loadState();
  normalizeSentenceNumbers(state);
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
    favoriteBtn: $("#favoriteBtn"), englishText: $("#englishText"), koreanText: $("#koreanText"), descriptionArea: $("#descriptionArea"), descriptionText: $("#descriptionText"),
    playStatus: $("#playStatus"), timerText: $("#timerText"), countdownArea: $("#countdownArea"), countdownNumber: $("#countdownNumber"), countdownLabel: $("#countdownLabel"),
    repeatSelect: $("#repeatSelect"), delaySelect: $("#delaySelect"), speedSelect: $("#speedSelect"), languageSelect: $("#languageSelect"),
    autoRecordToggle: $("#autoRecordToggle"), recordDurationSelect: $("#recordDurationSelect"),
    playlistCards: $("#playlistCards"), playlistDetail: $("#playlistDetail"), detailPlaylistName: $("#detailPlaylistName"),
    detailTotal: $("#detailTotal"), sentenceList: $("#sentenceList"), sortSelect: $("#sortSelect"), playModeSelect: $("#playModeSelect"),
    lessonCountBadge: $("#lessonCountBadge"), lessonSelect: $("#lessonSelect"), numberPicker: $("#numberPicker"),
    selectedCount: $("#selectedCount"), recordingList: $("#recordingList"), recordingCount: $("#recordingCount"), recordingSize: $("#recordingSize"),
    recordingSelectionBar: $("#recordingSelectionBar"), recordingSelectedCount: $("#recordingSelectedCount"),
    playlistDialog: $("#playlistDialog"), sentenceDialog: $("#sentenceDialog"), settingsDialog: $("#settingsDialog"), toast: $("#toast")
  };

  init();

  function init() {
    state.settings.autoRecord=false;
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
  // Older versions had a global ORDER but no per-lesson number.
  // Give those rows a local 1,2,3... in each lesson without deleting existing user data.
  function normalizeSentenceNumbers(data) {
    for (const playlist of data.playlists || []) {
      const groupUsed = new Map();
      const ordered = [...(playlist.sentences || [])].sort((a,b)=>(Number(a.order)||0)-(Number(b.order)||0));
      for (const s of ordered) {
        const lesson = lessonLabel(s.lesson);
        if (!groupUsed.has(lesson)) groupUsed.set(lesson, new Set());
        const used = groupUsed.get(lesson);
        let n = Number(s.number);
        if (!Number.isInteger(n) || n < 1) {
          n = 1;
          while (used.has(n)) n++;
          s.number = n;
        }
        used.add(n);
        if (!s.description) s.description = "";
      }
    }
  }
  function sentenceNumber(s) { return Number(s.number) || 1; }
  function lessonDisplay(value) {
    const n = lessonNumber(value);
    return n === 9999 ? (String(value||"").trim() || "기타") : `레슨 ${n}`;
  }
  function lessonNumber(value) {
    const m=String(value||"").match(/(\d{1,3})/);
    return m ? Number(m[1]) : 9999;
  }
  function lessonLabel(value) {
    const n=lessonNumber(value);
    return n===9999 ? (String(value||"").trim() || "기타") : `DAY ${String(n).padStart(3,"0")}`;
  }
  function playlistLessons(playlist=currentPlaylist()) {
    if(!playlist) return [];
    const map=new Map();
    for(const s of playlist.sentences){
      const label=lessonLabel(s.lesson);
      if(!map.has(label)) map.set(label, lessonNumber(s.lesson));
    }
    return [...map.entries()].sort((a,b)=>a[1]-b[1] || a[0].localeCompare(b[0])).map(x=>x[0]);
  }
  function sortedSentences(playlist = currentPlaylist()) {
    if (!playlist) return [];
    let list = [...playlist.sentences];
    if (state.selectedLessons?.length) {
      const selected = new Set(state.selectedLessons);
      list = list.filter(s => selected.has(lessonLabel(s.lesson)));
    }
    const selectedNumbers=getSelectedNumbers();
    if(selectedNumbers.length){
      list=list.filter(s=>selectedNumbers.includes(String(sentenceNumber(s))));
    }
    const sort = els.sortSelect?.value || "asc";
    const byLessonAndNumber = (a,b) =>
      lessonNumber(a.lesson) - lessonNumber(b.lesson) ||
      lessonLabel(a.lesson).localeCompare(lessonLabel(b.lesson)) ||
      sentenceNumber(a) - sentenceNumber(b) ||
      (Number(a.order)||0) - (Number(b.order)||0);
    if (sort === "desc") list.sort((a,b)=>byLessonAndNumber(b,a));
    else if (sort === "shuffle") list=shuffle(list);
    else list.sort(byLessonAndNumber);
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
    requestAnimationFrame(fitLandscapeSentences);
    const p = currentPlaylist();
    const s = currentSentence();
    els.currentPlaylistName.textContent = p?.name || "플레이리스트 없음";

    if (!p || !s) {
      els.sentenceCounter.textContent = "0 / 0";
      els.englishText.textContent = "플레이리스트에서 문장을 추가해 주세요.";
      els.koreanText.textContent = "";
      els.descriptionText.textContent = "";
      els.descriptionArea.classList.add("hidden");
      els.favoriteBtn.textContent = "☆";
      return;
    }

    const idx = p.sentences.findIndex(x=>x.id===s.id);
    state.currentIndex = idx >= 0 ? idx : 0;
    els.sentenceCounter.textContent = `${state.currentIndex+1} / ${p.sentences.length}`;
    els.englishText.textContent = s.english || "";
    els.koreanText.textContent = s.korean || "";
    els.descriptionText.textContent = s.description || "";
    els.descriptionArea.classList.toggle("hidden", !s.description || state.settings.showInfo===false);
    els.favoriteBtn.textContent = s.review ? "★" : "☆";
    els.favoriteBtn.classList.toggle("active", !!s.review);

    els.englishText.classList.remove("hidden");
    els.koreanText.classList.toggle("hidden", !s.korean);
  }

  function renderPlaylists() {
    state.selectedPlaylistIds = Array.isArray(state.selectedPlaylistIds) ? state.selectedPlaylistIds : [];
    els.playlistCards.innerHTML = state.playlists.length ? state.playlists.map(p=>{
      const reviewCount = p.sentences.filter(s=>s.review).length;
      const currentIdx = p.id===state.currentPlaylistId ? Math.max(0,p.sentences.findIndex(s=>s.id===state.currentSentenceId))+1 : 0;
      return `<article class="playlist-card" data-playlist-id="${p.id}">
        <input class="playlist-check" type="checkbox" data-playlist-check="${p.id}" ${state.selectedPlaylistIds.includes(p.id)?"checked":""} aria-label="플레이리스트 선택">
        <button class="play-mini" data-action="play-playlist">▶</button>
        <div class="card-main" data-action="open-playlist">
          <h3>${escapeHtml(p.name)}</h3>
          <div class="playlist-meta"><span>${Math.min(currentIdx,p.sentences.length)} / ${p.sentences.length}</span><span>${state.settings.speed}x</span><span>★ ${reviewCount}</span></div>
        </div>
        <button class="menu" data-action="playlist-menu">⋮</button>
      </article>`;
    }).join("") : `<p class="muted">플레이리스트가 없습니다.</p>`;
    const delBtn=$("#deletePlaylistsBtn");
    if(delBtn){
      const n=state.selectedPlaylistIds.length;
      delBtn.disabled=n===0;
      delBtn.textContent=n ? `삭제 (${n})` : "삭제";
    }
  }

  function renderLessonPicker(p) {
    const lessons = playlistLessons(p);
    const selected = state.selectedLessons?.length === 1 ? state.selectedLessons[0] : "";
    els.lessonCountBadge.textContent = `${p.sentences.length}개`;
    els.lessonSelect.innerHTML = `<option value="">전체 레슨</option>` +
      lessons.map(l => `<option value="${escapeHtml(l)}">${escapeHtml(lessonDisplay(l))}</option>`).join("");
    els.lessonSelect.value = selected && lessons.includes(selected) ? selected : "";
    const matching = selected ? p.sentences.filter(s=>lessonLabel(s.lesson)===selected) : p.sentences;
    const numbers=[...new Set(matching.map(s=>sentenceNumber(s)))].sort((a,b)=>a-b);
    const chosen=getSelectedNumbers();
    $("#numberDropdownSummary").textContent=chosen.length?chosen.map(n=>`${n}번`).join(", "):"전체 순번";
    els.numberPicker.innerHTML=`<button type="button" class="number-all ${chosen.length?"":"active"}" data-number-all>전체</button>`+
      numbers.map(n=>`<label class="number-option"><input type="checkbox" data-number="${n}" ${chosen.includes(String(n))?"checked":""}>${n}번</label>`).join("");
  }
  function getSelectedNumbers(){
    return Array.isArray(state.selectedNumbers)&&state.selectedNumbers.length ? state.selectedNumbers.map(String) : state.selectedNumber ? [String(state.selectedNumber)] : [];
  }
  function commitNumberSelection(){
    state.selectedSentenceIds=[];
    const first=sortedSentences()[0];
    if(first){state.currentSentenceId=first.id;renderStudy();}
    saveState();renderPlaylistDetail();
  }
  function bindNumberPicker(){
    const dropdown=$("#numberDropdown");
    els.numberPicker.addEventListener("click",e=>{
      if(e.target.closest("[data-number-all]")){
        state.selectedNumbers=[];state.selectedNumber="";commitNumberSelection();
      }
    });
    els.numberPicker.addEventListener("change",e=>{
      const input=e.target.closest("[data-number]");if(!input)return;
      const number=input.dataset.number;
      const selected=new Set(getSelectedNumbers());
      if(input.checked)selected.add(number);else selected.delete(number);
      state.selectedNumbers=[...selected].sort((a,b)=>Number(a)-Number(b));state.selectedNumber="";
      commitNumberSelection();
      // Keep keyboard focus after the options are refreshed.
      els.numberPicker.querySelector(`[data-number="${number}"]`)?.focus({preventScroll:true});
    });
    document.addEventListener("click",e=>{if(!dropdown.contains(e.target))dropdown.open=false;});
    dropdown.addEventListener("keydown",e=>{if(e.key==="Escape"){dropdown.open=false;$("#numberDropdownSummary").focus();}});
  }

  function renderPlaylistDetail() {
    const p = currentPlaylist();
    if (!p) return;
    els.detailPlaylistName.textContent = p.name;
    let list = sortedSentences(p);
    if (state.reviewOnly) list = list.filter(s=>s.review);
    els.detailTotal.textContent = `총 ${list.length}개 / 전체 ${p.sentences.length}개`;
    renderLessonPicker(p);
    els.sentenceList.innerHTML = list.length ? list.map((s,i)=>{
      const checked = state.selectedSentenceIds.includes(s.id);
      const stateIcon = s.review ? "★" : s.completed ? "✓" : "○";
      return `<div class="sentence-row" data-sentence-id="${s.id}">
        <input class="sentence-check" type="checkbox" ${checked?"checked":""} aria-label="문장 선택">
        <button class="play-one" data-action="play-one">▶</button>
        <div class="sentence-body" data-action="open-sentence">
          <div class="en">${escapeHtml(s.english||"")}</div>
          ${s.korean ? `<div class="kr">${escapeHtml(s.korean)}</div>`:""}
          <div class="sentence-lesson">${escapeHtml(lessonDisplay(s.lesson))} · ${sentenceNumber(s)}번</div>
        </div>
        <button class="state" data-action="toggle-review" aria-label="복습">${stateIcon}</button>
      </div>`;
    }).join("") : `<p class="muted">선택한 레슨에 문장이 없습니다.</p>`;
    els.selectedCount.textContent = `${state.selectedSentenceIds.length}개 선택`;
  }

  function hydrateSettings() {
    $("#advanceSelect").value=state.settings.autoNext?"next":"once";
    syncInfoButton();
    els.repeatSelect.value = state.settings.repeat;
    els.delaySelect.value = state.settings.delay;
    els.speedSelect.value = state.settings.speed;
    els.languageSelect.value = state.settings.language;
    els.autoRecordToggle.checked = !!state.settings.autoRecord;
    els.recordDurationSelect.value = state.settings.recordDuration;
    $("#autoNextToggle").checked = !!state.settings.autoNext;
    syncControlValues();
  }

  function bindEvents() {
    bindSwipeNavigation();
    window.addEventListener("resize",()=>requestAnimationFrame(fitLandscapeSentences));
    document.fonts?.ready.then(()=>requestAnimationFrame(fitLandscapeSentences));
    document.addEventListener("visibilitychange",()=>{if(document.hidden)stopEverything();});
    window.addEventListener("pagehide",stopEverything);
    els.navBtns.forEach(btn=>btn.addEventListener("click",()=>switchView(btn.dataset.view)));
    $("#settingsBtn").addEventListener("click",()=>els.settingsDialog.showModal());
    $("#addPlaylistBtn").addEventListener("click",()=>els.playlistDialog.showModal());
    $("#deletePlaylistsBtn").addEventListener("click", deleteSelectedPlaylists);
    $("#closePlaylistDetail").addEventListener("click",()=>els.playlistDetail.classList.add("hidden"));
    $("#addSentenceBtn").addEventListener("click",()=>openSentenceDialog());


    els.favoriteBtn.addEventListener("click",()=>toggleReview(currentSentence()?.id));
    $("#prevBtn").addEventListener("click",()=>moveSentence(-1));
    $("#nextBtn").addEventListener("click",()=>moveSentence(1));
    $("#playBtn").addEventListener("click",()=>{if(session.playing||session.pauseSpeech)togglePause();else startPractice();});
    $("#advanceSelect").addEventListener("change",()=>{state.settings.autoNext=$("#advanceSelect").value==="next";$("#autoNextToggle").checked=state.settings.autoNext;syncControlValues();saveState();});
    $("#infoBtn").addEventListener("click",()=>{state.settings.showInfo=state.settings.showInfo===false;saveState();renderStudy();syncInfoButton();});
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
    $("#autoNextToggle").addEventListener("change",()=>{state.settings.autoNext=$("#autoNextToggle").checked;$("#advanceSelect").value=state.settings.autoNext?"next":"once";syncControlValues();saveState()});

    els.playlistCards.addEventListener("click", handlePlaylistCardClick);
    els.playlistCards.addEventListener("change", e=>{
      const cb=e.target.closest(".playlist-check"); if(!cb)return;
      const id=cb.dataset.playlistCheck;
      state.selectedPlaylistIds=Array.isArray(state.selectedPlaylistIds)?state.selectedPlaylistIds:[];
      if(cb.checked && !state.selectedPlaylistIds.includes(id)) state.selectedPlaylistIds.push(id);
      if(!cb.checked) state.selectedPlaylistIds=state.selectedPlaylistIds.filter(x=>x!==id);
      saveState(); renderPlaylists();
    });
    els.sentenceList.addEventListener("click", handleSentenceListClick);
    els.sentenceList.addEventListener("change", handleSentenceCheck);

    els.sortSelect.addEventListener("change",renderPlaylistDetail);
    els.lessonSelect.addEventListener("change", () => {
      state.selectedLessons = els.lessonSelect.value ? [els.lessonSelect.value] : [];
      state.selectedNumber = ""; state.selectedNumbers=[];
      state.selectedSentenceIds = [];
      saveState(); renderPlaylistDetail();
    });
    bindNumberPicker();
    document.querySelectorAll(".icon-select select").forEach(select=>select.addEventListener("change",syncControlValues));
    if (els.playModeSelect) els.playModeSelect.addEventListener("change",()=>{state.playMode=els.playModeSelect.value;saveState()});
    $("#reviewOnlyBtn").addEventListener("click",()=>{state.reviewOnly=!state.reviewOnly;renderPlaylistDetail();toast(state.reviewOnly?"복습 문장만 표시합니다.":"전체 문장을 표시합니다.")});
    $("#playAllBtn").addEventListener("click",()=>startPlaylistPractice());
    $("#practiceSelectedBtn").addEventListener("click",()=>startSelectedPractice());

    $("#createPlaylistSubmit").addEventListener("click", createPlaylistFromDialog);
    $("#sentenceForm").addEventListener("submit",saveSentenceFromDialog);
    $("#sentenceEditorSelect").addEventListener("change",()=>{
      const id=$("#sentenceEditorSelect").value;
      openSentenceDialog(id?currentPlaylist()?.sentences.find(s=>s.id===id):null);
    });
    $("#cancelSentenceBtn").addEventListener("click",()=>els.sentenceDialog.close());
    $("#deleteSentenceBtn").addEventListener("click",()=>deleteSentenceById($("#editingSentenceId").value));

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

  function fitLandscapeSentences(){
    const landscape=window.matchMedia("(orientation:landscape) and (max-height:600px) and (pointer:coarse)").matches;
    for(const [element,base] of [[els.englishText,28],[els.koreanText,19]]){
      element.style.fontSize="";
      if(!landscape||!element.clientWidth||!element.textContent)continue;
      element.style.fontSize=`${base}px`;
      const available=element.clientWidth-2;
      if(element.scrollWidth>available){
        element.style.fontSize=`${Math.max(1,Math.floor(base*available/element.scrollWidth*10)/10)}px`;
      }
    }
  }

  function swipeDestination(viewId,dx,dy){
    if(Math.abs(dx)<48||Math.abs(dx)<Math.abs(dy)*1.4)return null;
    if(viewId==="studyView"&&dx<0)return "playlistView";
    if(viewId==="playlistView"&&dx>0)return "studyView";
    return null;
  }
  function bindSwipeNavigation(){
    const shell=$("#appShell");let gesture=null,suppressClickUntil=0;
    const excluded="button,input,select,textarea,a,audio,summary,dialog,.number-picker,.lesson-toolbar,.bottom-action-bar";
    const begin=(target,x,y,id)=>{
      gesture=null;
      if(document.querySelector("dialog[open]")||target.closest(excluded))return;
      const text=target.closest(".english-text,.korean-text");
      if(text&&text.scrollWidth>text.clientWidth+1)return;
      const view=target.closest(".view.active");
      if(!view||!["studyView","playlistView"].includes(view.id))return;
      gesture={x,y,id,view:view.id,vertical:false};
    };
    const move=(x,y,id,event)=>{
      if(!gesture||gesture.id!==id)return;
      const dx=x-gesture.x,dy=y-gesture.y;
      if(Math.abs(dy)>14&&Math.abs(dy)>Math.abs(dx)*1.2)gesture.vertical=true;
      if(!gesture.vertical&&Math.abs(dx)>18&&Math.abs(dx)>Math.abs(dy)*1.4&&event.cancelable)event.preventDefault();
    };
    const finish=(x,y,id)=>{
      const start=gesture;if(!start||start.id!==id)return;gesture=null;
      if(start.vertical)return;
      const destination=swipeDestination(start.view,x-start.x,y-start.y);
      if(destination&&document.querySelector(".view.active")?.id===start.view){
        suppressClickUntil=Date.now()+400;switchView(destination);
      }
    };
    shell.addEventListener("click",event=>{
      if(Date.now()<suppressClickUntil){event.preventDefault();event.stopImmediatePropagation();}
    },true);
    if(window.PointerEvent){
      shell.addEventListener("pointerdown",event=>{
        if(event.pointerType!=="touch"||!event.isPrimary)return;
        begin(event.target,event.clientX,event.clientY,event.pointerId);
      },{passive:true});
      document.addEventListener("pointermove",event=>move(event.clientX,event.clientY,event.pointerId,event),{passive:false});
      document.addEventListener("pointerup",event=>finish(event.clientX,event.clientY,event.pointerId),{passive:true});
      document.addEventListener("pointercancel",()=>{gesture=null;},{passive:true});
    }else{
      shell.addEventListener("touchstart",event=>{
        if(event.touches.length!==1){gesture=null;return;}
        const touch=event.touches[0];begin(event.target,touch.clientX,touch.clientY,touch.identifier);
      },{passive:true});
      shell.addEventListener("touchmove",event=>{
        if(event.touches.length!==1){gesture=null;return;}
        const touch=event.touches[0];move(touch.clientX,touch.clientY,touch.identifier,event);
      },{passive:false});
      shell.addEventListener("touchend",event=>{
        for(const touch of event.changedTouches)finish(touch.clientX,touch.clientY,touch.identifier);
      },{passive:true});
      shell.addEventListener("touchcancel",()=>{gesture=null;},{passive:true});
    }
  }

  function switchView(viewId) {
    if(viewId!=="playlistView"&&viewId!=="studyView")stopEverything();
    els.views.forEach(v=>v.classList.toggle("active",v.id===viewId));
    els.navBtns.forEach(b=>b.classList.toggle("active",b.dataset.view===viewId));
    if (viewId==="recordingsView") renderRecordings();
  }


  function deleteSelectedPlaylists() {
    const ids=Array.isArray(state.selectedPlaylistIds)?state.selectedPlaylistIds:[];
    if(!ids.length){ toast("삭제할 플레이리스트를 선택해 주세요."); return; }
    if(!confirm(`선택한 ${ids.length}개 플레이리스트를 삭제할까요?`)) return;
    state.playlists=state.playlists.filter(p=>!ids.includes(p.id));
    state.selectedPlaylistIds=[];
    if(!state.playlists.some(p=>p.id===state.currentPlaylistId)){
      state.currentPlaylistId=state.playlists[0]?.id||null;
      state.currentSentenceId=state.playlists[0]?.sentences[0]?.id||null;
      state.currentIndex=0;
    }
    saveState(); renderAll();
    toast("선택한 플레이리스트를 삭제했습니다.");
  }

  function handlePlaylistCardClick(e) {
    if (e.target.closest(".playlist-check")) return;
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

    if(session.playing&&p.id===state.currentPlaylistId&&!e.target.closest('[data-action="play-playlist"]')){
      els.playlistDetail.classList.remove("hidden");renderPlaylistDetail();return;
    }
    stopEverything();
    state.currentPlaylistId=p.id;
    state.currentSentenceId=p.sentences[0]?.id||null;
    state.currentIndex=0;
    saveState();

    if (e.target.closest('[data-action="play-playlist"]')) {
      switchView("studyView"); renderStudy(); startPlaylistPractice();
    } else {
      state.reviewOnly=false; state.selectedSentenceIds=[]; state.selectedLessons=[]; state.selectedNumber="";state.selectedNumbers=[];
      els.playlistDetail.classList.remove("hidden"); renderPlaylistDetail(); renderStudy();
    }
  }

  function handleSentenceListClick(e) {
    const row = e.target.closest(".sentence-row");
    if (!row) return;
    const id = row.dataset.sentenceId;

    if (e.target.closest('[data-action="toggle-review"]')) { toggleReview(id); return; }
    if (e.target.closest('[data-action="play-one"]')) {
      let list=sortedSentences();
      if(state.reviewOnly)list=list.filter(sentence=>sentence.review);
      const index=list.findIndex(sentence=>sentence.id===id);
      if(index<0)return;
      stopEverything();
      state.currentSentenceId=id;saveState();renderStudy();
      runQueue(list.slice(index),true);
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
    const list=state.reviewOnly ? sortedSentences(p).filter(s=>s.review) : p.sentences;
    if(!list.length)return;
    let idx=list.findIndex(s=>s.id===state.currentSentenceId);
    idx=(idx+delta+list.length)%list.length;
    state.currentSentenceId=list[idx].id;
    state.currentIndex=p.sentences.findIndex(s=>s.id===state.currentSentenceId);
    saveState(); renderStudy();
  }

  function createPlaylistFromDialog(e) {
    e.preventDefault();
    const name=$("#playlistNameInput").value.trim();
    const file=$("#importFileInput").files[0];
    if(!name){toast("플레이리스트 제목을 입력해 주세요.");return;}
    let p=state.playlists.find(x=>x.name===name);
    if(!p){ p={id:uid(),name,description:"",sentences:[]}; state.playlists.push(p); }
    state.currentPlaylistId=p.id; state.currentSentenceId=null; state.selectedLessons=[]; state.selectedNumber="";state.selectedNumbers=[];
    if(file) {
      importFileToPlaylist(file,p).then(()=>{
        normalizeSentenceNumbers(state);
        state.currentSentenceId=p.sentences[0]?.id||null; saveState(); renderAll();
        els.playlistDialog.close(); $("#playlistForm").reset();
        toast(`"${name}"에 ${p.sentences.length}개 문장을 가져왔습니다.`);
      }).catch(err=>{console.error(err);toast(err.message||"파일을 읽지 못했습니다.");});
    } else {
      saveState(); els.playlistDialog.close(); $("#playlistForm").reset(); renderAll(); toast("플레이리스트를 추가했습니다.");
    }
  }

  async function importFileToPlaylist(file,p) {
    const text=await file.text();
    if(file.name.toLowerCase().endsWith(".txt")) {
      p.sentences=text.split(/\r?\n/).map(x=>x.trim()).filter(Boolean).map((english,i)=>newSentence({english,order:i+1}));
      return;
    }
    if(file.name.toLowerCase().endsWith(".csv")) {
      const rows=parseCSV(text);
      if(!rows.length) throw new Error("파일에 문장이 없습니다.");
      const headers=rows[0].map(h=>h.trim().replace(/^\uFEFF/,"").toUpperCase());
      if(!headers.some(h=>["ENGLISH","EXAMPLE_EN"].includes(h))) {
        throw new Error("영어 문장 열을 찾지 못했습니다. ENGLISH 또는 EXAMPLE_EN 열을 확인해 주세요.");
      }
      const imported=rows.slice(1).filter(r=>r.some(Boolean)).map((r,i)=>{
        const v=(name)=>r[headers.indexOf(name)]??"";
        return newSentence({
          order:Number(v("ORDER"))||i+1, lesson:v("LESSON")||v("레슨")||v("DAY"),
          number: Number(v("순번")||v("NUMBER")||v("SEQUENCE")||v("SEQ"))||null,
          english:v("ENGLISH")||v("EXAMPLE_EN"), korean:v("KOREAN")||v("EXAMPLE_KR"), description:v("DESCRIPTION")||v("설명"),
          grammar:v("GRAMMAR"), structure:v("STRUCTURE"),
          words:[
            {word:v("WORD_1"),meaning:v("WORD_1_MEANING"),pronunciation:v("WORD_1_PRONUNCIATION"),pos:v("WORD_1_POS")},
            {word:v("WORD_2"),meaning:v("WORD_2_MEANING"),pronunciation:v("WORD_2_PRONUNCIATION"),pos:v("WORD_2_POS")}
          ]
        });
      }).filter(s=>s.english.trim());
      if(!imported.length) throw new Error("가져올 영어 문장이 없습니다. 파일 내용을 확인해 주세요.");
      p.sentences=imported;
      return;
    }
    throw new Error("CSV 또는 TXT 파일을 선택해 주세요. 엑셀 파일은 CSV 형식으로 저장한 뒤 선택해 주세요.");
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
      id:uid(),order:data.order||1,lesson:data.lesson||"",number:data.number||null,
      english:data.english||"",korean:data.korean||"",description:data.description||"",
      grammar:data.grammar||"",structure:data.structure||"",words:data.words||[],memo:data.memo||"",
      review:false,completed:false,lastStudiedAt:null
    };
  }

  function openSentenceDialog(s=null) {
    const p=currentPlaylist();if(!p){toast("먼저 플레이리스트를 선택해 주세요.");return;}
    const choices=[...p.sentences].sort((a,b)=>lessonNumber(a.lesson)-lessonNumber(b.lesson)||lessonLabel(a.lesson).localeCompare(lessonLabel(b.lesson))||sentenceNumber(a)-sentenceNumber(b));
    $("#sentenceEditorSelect").innerHTML='<option value="">＋ 새 문장 추가</option>'+choices.map(item=>`<option value="${escapeHtml(item.id)}">${escapeHtml(lessonDisplay(item.lesson))} · ${sentenceNumber(item)}번 · ${escapeHtml(item.english.slice(0,65))}</option>`).join("");
    $("#sentenceEditorSelect").value=s?.id||"";
    $("#saveSentenceBtn").textContent=s?"수정 저장":"추가";
    const lesson=s?.lesson||(state.selectedLessons?.length===1?lessonDisplay(state.selectedLessons[0]).replace(/^레슨\s*/,""):currentSentence()?.lesson)||"1";
    const existing=p.sentences.filter(item=>lessonLabel(item.lesson)===lessonLabel(lesson));
    const next=existing.reduce((max,item)=>Math.max(max,sentenceNumber(item)),0)+1;
    $("#sentenceDialogTitle").textContent=s?"문장 수정":"문장 추가";
    $("#editingSentenceId").value=s?.id||"";
    $("#lessonInput").value=lesson;
    $("#numberInput").value=s?sentenceNumber(s):next;
    $("#englishInput").value=s?.english||"";
    $("#koreanInput").value=s?.korean||"";
    $("#descriptionInput").value=s?.description||"";
    $("#deleteSentenceBtn").classList.toggle("hidden",!s);
    if(!els.sentenceDialog.open)els.sentenceDialog.showModal();
  }

  function saveSentenceFromDialog(e) {
    e.preventDefault();
    const form=$("#sentenceForm");if(!form.reportValidity())return;
    const p=currentPlaylist();if(!p)return;
    const id=$("#editingSentenceId").value;
    const lesson=$("#lessonInput").value.trim();
    const number=Number($("#numberInput").value);
    const english=$("#englishInput").value.trim();
    if(!lesson||!english||!Number.isSafeInteger(number)||number<1){toast("레슨·순번·영어 문장을 확인해 주세요.");return;}
    if(p.sentences.some(item=>item.id!==id&&lessonLabel(item.lesson)===lessonLabel(lesson)&&sentenceNumber(item)===number)){
      toast("같은 레슨에 해당 순번이 이미 있습니다. 다른 순번을 입력해 주세요.");return;
    }
    let sentence=p.sentences.find(item=>item.id===id);
    if(id&&!sentence){toast("수정할 문장을 찾지 못했습니다.");return;}
    stopEverything();
    if(!sentence){sentence=newSentence({order:p.sentences.length+1});p.sentences.push(sentence);}
    Object.assign(sentence,{lesson,number,english,korean:$("#koreanInput").value.trim(),description:$("#descriptionInput").value.trim()});
    state.currentSentenceId=sentence.id;
    if(state.selectedLessons?.length&&!state.selectedLessons.includes(lessonLabel(lesson)))state.selectedLessons=[];
    if(getSelectedNumbers().length&&!getSelectedNumbers().includes(String(number))){state.selectedNumbers=[];state.selectedNumber="";}
    saveState();els.sentenceDialog.close();renderAll();toast(id?"문장을 수정했습니다.":"문장을 추가했습니다.");
  }

  function deleteSentenceById(id) {
    const p=currentPlaylist(),index=p?.sentences.findIndex(item=>item.id===id);
    if(!p||index<0)return;
    if(!confirm("이 문장을 삭제할까요?"))return;
    stopEverything();
    p.sentences.splice(index,1);
    state.selectedSentenceIds=state.selectedSentenceIds.filter(selected=>selected!==id);
    if(state.currentSentenceId===id)state.currentSentenceId=p.sentences[Math.min(index,p.sentences.length-1)]?.id||null;
    saveState();if(els.sentenceDialog.open)els.sentenceDialog.close();renderAll();toast("문장을 삭제했습니다.");
  }

  async function startPractice() {
    if(session.paused){togglePause();return;}
    if(session.playing){toast("이미 재생 중입니다.");return;}
    let list=sortedSentences();
    if(state.reviewOnly)list=list.filter(s=>s.review);
    if(!list.length){toast(state.reviewOnly?"별표 표시한 복습 문장이 없습니다.":"재생할 문장이 없습니다.");return;}
    const index=list.findIndex(s=>s.id===state.currentSentenceId);
    list=index>=0?list.slice(index):list;
    if(!state.settings.autoNext)list=list.slice(0,1);
    await runQueue(list);
  }

  async function practiceSentence(s,runId=playbackGeneration) {
    const check=()=>{if(session.stopRequested||runId!==playbackGeneration)throw new Error("STOP");};
    check();
    const repeat = state.settings.repeat==="infinite" ? Infinity : Number(state.settings.repeat);
    let count=0;
    while(count<repeat && !session.stopRequested) {
      count++;
      check();
      const lang=state.settings.language;
      if(lang==="EN") await speakText(s.english,"en-US");
      if(lang==="KR") await speakText(s.korean,"ko-KR");
      if(lang==="EN_KR"){ await speakText(s.english,"en-US"); check(); if(s.korean) await speakText(s.korean,"ko-KR"); }
      if(lang==="KR_EN"){
        if(s.korean){
          await speakText(s.korean,"ko-KR");
          check();
          await countdown(Number(state.settings.delay));
          check();
        }
        await speakText(s.english,"en-US");
      }
      check();

      if(state.settings.autoRecord) {
        setStatus("🎤 녹음 중");
        const duration=state.settings.recordDuration;
        await startRecording(duration==="manual"?null:Number(duration)*1000, s);
      }

      if(count<repeat || repeat===Infinity) {
        await countdown(Number(state.settings.delay));
      }
    }
    check();
    s.completed=true; s.lastStudiedAt=Date.now(); saveState(); renderAll();

  }

  async function startPlaylistPractice() {
    const p=currentPlaylist(); if(!p?.sentences.length)return;
    let list=sortedSentences(p); if(state.reviewOnly)list=list.filter(s=>s.review);
    if(els.sortSelect?.value==="shuffle") list=shuffle([...list]);
    stopEverything();
    switchView("studyView");
    await runQueue(list);
  }

  async function startSelectedPractice() {
    const p=currentPlaylist(); if(!p)return;
    let list=sortedSentences(p).filter(s=>state.selectedSentenceIds.includes(s.id));
    if(!list.length){toast("연습할 문장을 선택해 주세요.");return;}
    if(els.sortSelect?.value==="shuffle") list=shuffle(list);
    stopEverything();switchView("studyView"); await runQueue(list);
  }

  async function runQueue(list,forceContinuous=false) {
    if(session.playing)return;
    session.playing=true; session.stopRequested=false; session.currentPlayQueue=list;
    const runId=++playbackGeneration;
    try {
      for(const s of list) {
        if(session.stopRequested||runId!==playbackGeneration)break;
        state.currentSentenceId=s.id; saveState(); renderStudy();
        await practiceSentence(s,runId);
        if(!forceContinuous&&!state.settings.autoNext)break;
      }
    } catch(err){if(err?.message!=="STOP")console.error(err)}
    finally{if(runId===playbackGeneration){session.playing=false;session.currentPlayQueue=null;setStatus("준비")}}
  }

  function shuffle(a){for(let i=a.length-1;i>0;i--){const j=Math.floor(Math.random()*(i+1));[a[i],a[j]]=[a[j],a[i]]}return a}

  let speechReady=false;
  let playbackGeneration=0;
  const playbackCancellations=new Set();

  function prepareSpeech() {
    if(!("speechSynthesis" in window) || !("SpeechSynthesisUtterance" in window)) return false;
    try {
      speechSynthesis.getVoices();
      speechReady=true;
      return true;
    } catch(e) { console.warn("speech init failed",e); return false; }
  }

  function chooseVoice(lang) {
    const voices=speechSynthesis.getVoices?.()||[];
    const wanted=(lang||"").toLowerCase();
    const base=wanted.split("-")[0];
    return voices.find(v=>(v.lang||"").toLowerCase()===wanted)
      || voices.find(v=>(v.lang||"").toLowerCase().startsWith(base))
      || null;
  }

  function speakText(text,lang) {
    return new Promise((resolve,reject)=>{
      if(!text){resolve();return;}
      if(session.stopRequested){reject(new Error("STOP"));return;}
      if(!prepareSpeech()){toast("이 브라우저에서는 음성 재생을 지원하지 않습니다.");resolve();return;}
      let finished=false, attempt=0, active=false, elapsed=0, last=Date.now(), launchTimer, clock;
      const cancel=()=>finish(new Error("STOP"));
      const finish=(err)=>{
        if(finished)return;
        finished=true;attempt++;clearTimeout(launchTimer);clearInterval(clock);
        playbackCancellations.delete(cancel);
        if(session.pauseSpeech===pause){session.pauseSpeech=null;session.resumeSpeech=null;}
        if(err)reject(err);else resolve();
      };
      const start=()=>{
        if(finished||session.paused)return;
        const id=++attempt;
        const u=new SpeechSynthesisUtterance(text);
        u.lang=lang;u.rate=Number(state.settings.speed)||0.8;
        const voice=chooseVoice(lang);if(voice)u.voice=voice;
        u.onstart=()=>{if(id===attempt&&!session.paused)setStatus("🎧 재생 중");};
        u.onend=()=>{if(id===attempt&&!session.paused)finish();};
        u.onerror=()=>{if(id===attempt&&!session.paused)finish(session.stopRequested?new Error("STOP"):undefined);};
        active=true;elapsed=0;last=Date.now();
        try{speechSynthesis.resume();speechSynthesis.speak(u);}catch(e){finish(e);}
      };
      // Native pause is unreliable on some mobile browsers. Resume the current utterance.
      const pause=()=>{attempt++;active=false;clearTimeout(launchTimer);try{speechSynthesis.cancel();}catch{}};
      session.pauseSpeech=pause;session.resumeSpeech=start;
      playbackCancellations.add(cancel);
      const estimated=Math.max(4000,Math.min(30000,text.length*180/(Number(state.settings.speed)||0.8)));
      clock=setInterval(()=>{
        const now=Date.now();
        if(active&&!session.paused)elapsed+=now-last;
        last=now;
        if(elapsed>=estimated){attempt++;try{speechSynthesis.cancel();}catch{}finish();}
      },100);
      try{speechSynthesis.cancel();}catch{}
      launchTimer=setTimeout(start,90);
    });
  }

  function togglePause() {
    if(!session.playing&&!session.pauseSpeech)return;
    session.paused=!session.paused;
    const button=$("#playBtn");
    if(button){button.textContent=session.paused?"▶":"Ⅱ";button.setAttribute("aria-label",session.paused?"재개":"일시정지");}
    if(session.paused){session.pauseSpeech?.();setStatus("Ⅱ 일시정지");}
    else{session.resumeSpeech?.();setStatus(session.pauseSpeech?"🎧 재생 중":"지연 중");}
  }

  function stopEverything() {
    playbackGeneration++;
    session.stopRequested=true; session.paused=false; session.playing=false; session.currentPlayQueue=null;
    for(const cancel of [...playbackCancellations])cancel();
    try{window.speechSynthesis?.cancel();}catch{}
    document.querySelectorAll("audio").forEach(audio=>audio.pause());
    if(session.timer){clearTimeout(session.timer);session.timer=null;}
    if(session.mediaRecorder?.state==="recording") session.mediaRecorder.stop();
    const pauseButton=$("#playBtn");if(pauseButton){pauseButton.textContent="▶";pauseButton.setAttribute("aria-label","재생");}
    els.countdownArea.classList.add("hidden"); setStatus("정지");
  }

  function countdown(seconds) {
    return new Promise((resolve,reject)=>{
      let remaining=Math.max(0,Number(seconds))*1000,last=Date.now(),timer,finished=false;
      const finish=(err)=>{if(finished)return;finished=true;clearInterval(timer);playbackCancellations.delete(cancel);els.countdownArea.classList.add("hidden");if(err)reject(err);else resolve();};
      const cancel=()=>finish(new Error("STOP"));
      playbackCancellations.add(cancel);
      els.countdownArea.classList.remove("hidden");els.countdownLabel.textContent="지연";
      els.countdownNumber.textContent=`${Math.ceil(remaining/1000)}초`;setStatus("지연 중");
      timer=setInterval(()=>{
        const now=Date.now();
        if(session.stopRequested){cancel();return;}
        if(!session.paused)remaining-=now-last;
        last=now;
        els.countdownNumber.textContent=`${Math.max(0,Math.ceil(remaining/1000))}초`;
        if(remaining<=0)finish();
      },100);
    });
  }

  function syncControlValues(){
    document.querySelectorAll("[data-value-for]").forEach(span=>{
      const select=document.getElementById(span.dataset.valueFor);
      span.textContent=select.id==="speedSelect"?`×${select.value}`:(select.selectedOptions[0]?.textContent||"");
    });
  }
  function syncInfoButton(){
    const shown=state.settings.showInfo!==false;
    $("#infoBtn").setAttribute("aria-pressed",String(shown));
    $("#infoValue").textContent=shown?"전체":"숨김";
  }
  function setStatus(text){
    els.playStatus.textContent=text;
    const button=$("#playBtn");
    const running=(session.playing||!!session.pauseSpeech)&&!session.paused;
    button.textContent=running?"Ⅱ":"▶";button.setAttribute("aria-label",running?"일시정지":"재생");
  }

  let recordButtonTimer=null;
  function setRecordButton(mode) {
    clearTimeout(recordButtonTimer);
    const button=els.recordBtn;
    button.classList.toggle("active",mode==="recording");
    button.classList.toggle("record-label",mode!=="idle");
    const recording=mode==="recording";
    const label=recording?"녹음 중":mode==="complete"?"녹음 완료":mode==="saving"?"저장 중":mode==="starting"?"권한 확인":"";
    button.innerHTML=(recording?'<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3M8 22h8"/></svg>':'<svg viewBox="0 0 28 28" aria-hidden="true"><rect x="9" y="2" width="6" height="12" rx="3"/><path d="M5 10v2a7 7 0 0 0 12 5M19 10v2M12 19v3M8 22h8"/><path class="mic-off-cross" d="M20 19l6 6M26 19l-6 6"/></svg>')+(label?`<span class="record-state-label">${label}</span>`:"");
    button.setAttribute("aria-label",recording?"녹음 중, 누르면 종료":"녹음 꺼짐, 누르면 시작");
    button.title=recording?"녹음 중":"녹음 안 함";
    button.setAttribute("aria-pressed",String(mode==="recording"));
    if(mode==="complete")recordButtonTimer=setTimeout(()=>setRecordButton("idle"),1200);
  }

  async function toggleManualRecording() {
    if(session.recordingStarting||session.recordingSaving)return;
    if(session.mediaRecorder?.state==="recording"){
      session.recordingSaving=true;setRecordButton("saving");session.mediaRecorder.stop();return;
    }
    if(session.playing||session.pauseSpeech)stopEverything();
    session.recordingStarting=true;setRecordButton("starting");setStatus("마이크 권한을 확인하고 있습니다.");
    try{await startRecording(null,currentSentence());}
    catch(err){
      console.error(err);setRecordButton("idle");
      const message=recordingErrorMessage(err);setStatus(message);toast(message);
    }
    finally{session.recordingStarting=false;}
  }

  function recordingErrorMessage(error){
    if(error?.message==="STOP")return "녹음 취소";
    if(["NotAllowedError","PermissionDeniedError","SecurityError"].includes(error?.name))return "마이크 권한이 꺼져 있습니다. 주소창 옆 사이트 설정에서 마이크를 허용해 주세요.";
    if(["NotFoundError","DevicesNotFoundError"].includes(error?.name))return "사용할 마이크를 찾지 못했습니다. 마이크 연결을 확인해 주세요.";
    if(["NotReadableError","TrackStartError"].includes(error?.name))return "마이크를 사용하지 못했습니다. 다른 녹음·통화 앱을 종료하고 다시 눌러 주세요.";
    return error?.message||"녹음을 시작하지 못했습니다. 브라우저의 마이크 권한을 확인해 주세요.";
  }
  async function startRecording(durationMs=null,sentence=null) {
    if(session.mediaRecorder?.state==="recording")return;
    if(!navigator.mediaDevices?.getUserMedia)throw new Error("이 화면에서는 마이크를 사용할 수 없습니다. 보안 연결된 주소를 크롬 또는 사파리에서 열어 주세요.");
    const Recorder=window.MediaRecorder;
    if(!Recorder)throw new Error("이 브라우저는 녹음을 지원하지 않습니다. 크롬 또는 사파리에서 다시 열어 주세요.");
    const generation=playbackGeneration;
    try{if(window.speechSynthesis?.speaking)window.speechSynthesis.cancel();}catch{}
    const stream=await navigator.mediaDevices.getUserMedia({audio:true});
    if(generation!==playbackGeneration){stream.getTracks().forEach(track=>track.stop());throw new Error("STOP");}
    let rec;
    try{
      const preferred=["audio/webm;codecs=opus","audio/mp4","audio/webm"];
      const mime=typeof Recorder.isTypeSupported==="function"?preferred.find(type=>Recorder.isTypeSupported(type)):null;
      try{rec=mime?new Recorder(stream,{mimeType:mime}):new Recorder(stream);}catch{rec=new Recorder(stream);}
    }catch(error){stream.getTracks().forEach(track=>track.stop());throw error;}
    session.mediaStream=stream;session.chunks=[];
    const chunks=session.chunks;
    session.mediaRecorder=rec;
    rec.ondataavailable=e=>{if(e.data.size)chunks.push(e.data)};
    const done=new Promise(resolve=>{
      rec.onstop=async()=>{
        const blob=new Blob(chunks,{type:rec.mimeType||chunks[0]?.type||"audio/webm"});
        stream.getTracks().forEach(t=>t.stop());
        const elapsed=Math.max(0,(Date.now()-session.recordingStartedAt)/1000);
        session.recordingSaving=true;
        setRecordButton("saving");
        try {
        await addRecording({
          id:uid(),blob,mimeType:blob.type,createdAt:Date.now(),duration:elapsed,
          sentenceId:sentence?.id||null,english:sentence?.english||"직접 녹음",
          name:`sentence_${String((state.currentIndex||0)+1).padStart(3,"0")}_${dateStamp()}.${extensionFor(blob.type)}`
        });
        setRecordButton("complete");setStatus("✓ 녹음 완료");
        } catch(err){console.error(err);setRecordButton("idle");setStatus("녹음 저장 실패");toast("녹음을 저장하지 못했습니다.");}
        finally{session.recordingSaving=false;session.mediaRecorder=null;session.mediaStream=null;resolve();}
        renderRecordings().catch(console.error);
      };
    });
    session.recordingStartedAt=Date.now();
    try{rec.start();}catch(error){stream.getTracks().forEach(track=>track.stop());session.mediaRecorder=null;session.mediaStream=null;throw error;}
    setRecordButton("recording");setStatus("🎤 녹음 중");
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

  function readRecordingBytes(blob){
    if(typeof blob.arrayBuffer==="function")return blob.arrayBuffer();
    return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(reader.error);reader.readAsArrayBuffer(blob);});
  }
  function decodeRecording(context,bytes){
    return new Promise((resolve,reject)=>{
      let settled=false;
      const ok=buffer=>{if(!settled){settled=true;resolve(buffer);}};
      const fail=error=>{if(!settled){settled=true;reject(error);}};
      try{
        const result=context.decodeAudioData(bytes.slice(0),ok,fail);
        if(result&&typeof result.then==="function")result.then(ok,fail);
      }catch(error){fail(error);}
    });
  }
  function joinRecordingBuffers(context,buffers){
    const sampleRate=context.sampleRate||buffers[0].sampleRate;
    const channels=Math.max(...buffers.map(b=>b.numberOfChannels));
    const lengths=buffers.map(b=>Math.max(1,Math.round(b.length*sampleRate/b.sampleRate)));
    const total=lengths.reduce((sum,n)=>sum+n,0);
    const merged=context.createBuffer(channels,total,sampleRate);
    let offset=0;
    buffers.forEach((b,index)=>{
      const length=lengths[index];
      for(let ch=0;ch<channels;ch++){
        const source=b.getChannelData(Math.min(ch,b.numberOfChannels-1));
        const target=merged.getChannelData(ch);
        if(b.sampleRate===sampleRate){target.set(source,offset);continue;}
        for(let i=0;i<length;i++){
          const position=i*b.sampleRate/sampleRate;
          const left=Math.min(Math.floor(position),source.length-1),right=Math.min(left+1,source.length-1);
          const fraction=position-left;
          target[offset+i]=source[left]*(1-fraction)+source[right]*fraction;
        }
      }
      offset+=length;
    });
    return merged;
  }
  async function mergeSelectedRecordings(){
    const button=$("#mergeBtn");if(button.disabled)return;
    const ids=selectedRecordingIds();
    if(ids.length<2){toast("병합할 녹음을 2개 이상 체크해 주세요.");return;}
    const Context=window.AudioContext||window.webkitAudioContext;
    if(!Context){toast("이 브라우저는 녹음 병합을 지원하지 않습니다. 다른 브라우저에서 시도해 주세요.");return;}
    let context;
    button.disabled=true;button.textContent="병합 중…";
    try{
      // Start the context while this call still has the user's button gesture.
      context=new Context();
      const resumed=context.state==="suspended"?context.resume():null;
      if(resumed&&typeof resumed.catch==="function")resumed.catch(console.warn);
      const buffers=[];
      for(let index=0;index<ids.length;index++){
        button.textContent=`변환 ${index+1}/${ids.length}`;
        const record=await getRecording(ids[index]);
        if(!record?.blob?.size)throw new Error(`${index+1}번째 녹음 파일이 없거나 비어 있습니다.`);
        try{
          const buffer=await decodeRecording(context,await readRecordingBytes(record.blob));
          if(!buffer?.length)throw new Error("empty audio");
          buffers.push(buffer);
        }catch(error){console.error(error);throw new Error(`${index+1}번째 녹음의 음성 형식을 읽지 못했습니다. 해당 파일을 다운로드해 확인해 주세요.`);}
      }
      button.textContent="파일 저장 중…";
      const merged=joinRecordingBuffers(context,buffers);
      const blob=new Blob([audioBufferToWav(merged)],{type:"audio/wav"});
      const name=`FLORA_Practice_${dateStamp()}.wav`;
      await addRecording({id:uid(),blob,mimeType:"audio/wav",createdAt:Date.now(),duration:merged.duration,sentenceId:null,english:"병합 녹음",name});
      await renderRecordings();
      toast("병합 완료! 녹음 목록 맨 위의 ‘병합 녹음’에서 재생하거나 다운로드해 주세요.");
    }catch(error){console.error(error);toast(error.message||"녹음 병합 중 오류가 발생했습니다.");}
    finally{
      if(context&&context.state!=="closed"){try{await context.close();}catch{}}
      button.disabled=false;button.textContent="병합";
    }
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