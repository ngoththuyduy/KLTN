# Ke hoach fix bug va rui ro source

Tai lieu nay gom cac loi/rui ro da ra soat trong source va sap xep thanh tung cum de fix theo thu tu uu tien. Muc tieu la dua he thong tu trang thai demo/PoC sang trang thai an toan hon, du lieu dung hon, va de van hanh hon.

## Tong quan uu tien

1. **P0 - Bat buoc fix truoc khi public/production**
   - Firestore rules dang mo toan bo read/write.
   - Dang nhap/demo/localStorage cho phep leo quyen `SYSTEM_ADMIN`.
   - Backend API khong xac thuc role/token.
   - Du lieu chat/file/report doc ghi theo collection toan cuc, de lo/tron du lieu nguoi dung.

2. **P1 - Fix som de tranh bao cao sai va hanh vi sai**
   - AI/RAG dung fallback zero-vector hoac mock/simulated thanh cong.
   - Parser tu suy loi nhuan, nhan vien, khu vuc khi du lieu thieu.
   - Upload bao `READY` truoc khi ingestion that su hoan thanh.
   - Toggle Vector Search va model config khong duoc backend/service dung dung nghia.

3. **P2 - Fix de tang chat luong san pham va van hanh**
   - Chuoi tieng Viet bi loi ma hoa.
   - Build production canh bao `import.meta` khi bundle CJS.
   - Bundle frontend qua lon.
   - Markdown/raw HTML/print HTML can duoc sanitize ro rang.

## Cum 1: Bao mat Firestore va phan quyen that

### Loi hien tai

- `firestore.rules` dang co `allow read, write: if true;`, bat ky ai co config Firebase deu co the doc/ghi/xoa moi collection.
- `firestore.rules.test.ts` ky vong cac case nhu Identity Theft, Privilege Escalation, Unauthorized Read phai fail, nhung rules hien tai lai cho pass.
- Role trong UI khong duoc enforce o database.

### File lien quan

- `firestore.rules`
- `firestore.rules.test.ts`
- `security_spec.md`
- `src/lib/AuthContext.tsx`
- `src/pages/Login.tsx`
- `src/pages/Register.tsx`
- `src/pages/Settings.tsx`

### Huong fix step by step

1. Thiet ke lai schema role toi thieu:
   - `users/{uid}` chua `role`, `status`, `email`, `fullName`, `createdAt`.
   - Moi document du lieu nguoi dung tao ra can co `ownerId` hoac `userId`.
   - File/report/chat neu dung chung theo cong ty thi can them `orgId`; neu chua co org, dung `ownerId`.

2. Viet helper rules:
   - `signedIn()`
   - `isSelf(uid)`
   - `userProfile()`
   - `isActive()`
   - `hasRole(role)`
   - `isSystemAdmin()`
   - `isOwner(resourceUserId)`

3. Thay rule mo bang rule theo collection:
   - `users/{uid}`: user doc duoc doc chinh minh; `SYSTEM_ADMIN` doc danh sach; chi admin duoc doi role/status.
   - `files/{fileId}`: chi owner/admin duoc doc/ghi; manager chi doc neu can.
   - `files/{fileId}/records/{recordId}`: ke thua quyen tu parent file.
   - `knowledge_chunks/{chunkId}`: chi owner/admin hoac file owner duoc doc/ghi.
   - `chat_sessions/{sessionId}` va messages: chi owner/admin duoc doc/ghi.
   - `reports/{reportId}`: chi owner/admin/manager duoc doc theo yeu cau nghiep vu.
   - `config/global`: chi `SYSTEM_ADMIN` duoc ghi; doc nen gioi han admin hoac tra ve ban public khong co secret.

4. Cap nhat `firestore.rules.test.ts`:
   - Them setup user roles bang test env.
   - Test user khong doc chat/file/report cua nguoi khac.
   - Test user khong tu doi role.
   - Test admin doi role thanh cong.
   - Test unauthenticated bi deny.

5. Chay verify:
   - Chay rules test qua Firebase emulator.
   - Chay `npm run lint`.
   - Chay thao tac UI voi 3 role: `SYSTEM_ADMIN`, `SALES_ADMIN`, `SALES_MANAGER`.

### Tieu chi done

- Khong con `allow read, write: if true`.
- Rules test pass voi ca `assertFails` va `assertSucceeds`.
- Mot user khong the doc/xoa chat, file, report cua user khac bang client SDK.

## Cum 2: Xac thuc backend API va quan ly secret

### Loi hien tai

- `/api/config`, `/api/trigger-daily-scheduler`, `/api/send-email`, `/api/chat`, `/api/analyze`, `/api/embeddings` khong verify Firebase ID token.
- Client co the gui `geminiApiKey` len request body.
- Gemini API key va SMTP password dang luu/lay tu `localStorage`, de bi lo neu co XSS.
- Nodemailer dung `tls.rejectUnauthorized: false`, lam giam an toan TLS.

### File lien quan

- `server.ts`
- `src/lib/gemini.ts`
- `src/pages/Settings.tsx`
- `src/pages/Dashboard.tsx`

### Huong fix step by step

1. Tao middleware `requireAuth` tren Express:
   - Client gui Firebase ID token trong header `Authorization: Bearer <token>`.
   - Server verify token bang Firebase Admin SDK.
   - Gan `req.user = { uid, email }`.

2. Tao middleware `requireRole([...])`:
   - Doc `users/{uid}` tu Firestore server-side.
   - Kiem tra `status === ACTIVE`.
   - Kiem tra role hop le.

3. Gan quyen cho route:
   - `/api/config` GET/POST: chi `SYSTEM_ADMIN`.
   - `/api/trigger-daily-scheduler`: chi `SYSTEM_ADMIN`.
   - `/api/send-email`: chi role duoc phep gui bao cao.
   - `/api/chat`, `/api/analyze`, `/api/embeddings`: yeu cau signed-in, co rate limit.

4. Loai bo viec client gui secret:
   - Xoa `geminiApiKey` khoi body request.
   - Server chi lay key tu env/secret store/config server-side.
   - Neu can per-user key, ma hoa o server, khong luu plain text tren client.

5. Bao ve SMTP:
   - Khong luu `sales_smtp_pass` trong `localStorage`.
   - Chi chap nhan SMTP config server-side hoac encrypted.
   - Bo `rejectUnauthorized: false`, chi dung khi co flag dev ro rang.

6. Them rate limit va kich thuoc payload:
   - Giam/gioi han payload `/api/chat`, `/api/analyze`, `/api/send-email`.
   - Them IP/user rate limit de tranh spam AI/email.

### Tieu chi done

- Goi API khong token tra 401.
- Goi API dung token nhung sai role tra 403.
- Secret khong con xuat hien trong localStorage.
- SMTP TLS mac dinh verify certificate.

## Cum 3: Dang nhap, role va demo mode

### Loi hien tai

- App khoi tao mac dinh `SYSTEM_ADMIN` trong `AuthContext`.
- Login fallback tu dong tao user hoac bypass demo thanh admin.
- Register cho user tu chon role.
- Layout cho doi role nhanh bang localStorage.

### File lien quan

- `src/lib/AuthContext.tsx`
- `src/pages/Login.tsx`
- `src/pages/Register.tsx`
- `src/components/Layout.tsx`
- `src/pages/Settings.tsx`

### Huong fix step by step

1. Loai bo default admin session:
   - Initial `profile` va `user` phai la `null` neu chua login that.
   - `loading` bat dau la `true` den khi Firebase Auth resolve.

2. Tach demo mode:
   - Demo chi bat khi `VITE_ENABLE_DEMO_AUTH=true`.
   - Demo data dung project/local namespace rieng, khong ghi vao production Firestore.
   - Demo role co dinh, khong cho tu chon `SYSTEM_ADMIN` neu dang production.

3. Register:
   - User moi mac dinh `SALES_MANAGER` hoac `PENDING`.
   - Khong cho user tu chon role trong form.
   - Role chi admin cap trong Settings.

4. Login:
   - Bo auto-register khi login fail.
   - Khong dung fallback password `password123`.
   - Loi auth can hien thong bao ro, khong bypass.

5. Role switcher:
   - Bo nut doi role nhanh khoi Layout production.
   - Neu can test, chi hien khi demo/dev flag bat.

### Tieu chi done

- Mo app lan dau chua login se vao `/login`, khong tu co admin.
- User moi khong the tu dang ky thanh `SYSTEM_ADMIN`.
- Sua localStorage khong lam doi quyen Firestore/API.

## Cum 4: Phan tach du lieu nguoi dung va quyen truy cap theo owner

### Loi hien tai

- Chat, files, reports dang query collection toan cuc.
- Xoa tat ca chat/file co the xoa du lieu cua user khac.
- `uploadedBy` chi la ten hien thi, khong du lam owner.

### File lien quan

- `src/pages/Chat.tsx`
- `src/pages/DataManagement.tsx`
- `src/pages/Dashboard.tsx`
- `src/pages/Reports.tsx`
- `src/lib/chatStorage.ts`
- `src/lib/fileStorage.ts`
- `src/lib/reportStorage.ts`
- `src/services/ragService.ts`
- `src/services/vectorSearch.ts`

### Huong fix step by step

1. Chuan hoa document metadata:
   - Moi `files` co `ownerId`, `createdBy`, `orgId?`.
   - Moi `chat_sessions` co `userId` bat buoc.
   - Moi `reports` co `ownerId`/`generatedFor`/`orgId?`.
   - Moi `knowledge_chunks` co `ownerId`, `sourceFileId`.

2. Sua query:
   - Chat sessions: `where('userId', '==', currentUid)`.
   - Files: `where('ownerId', '==', currentUid)` hoac theo role/org.
   - Reports: filter theo owner/org/role.
   - RAG/vector search: chi fetch chunk cua file ma user co quyen.

3. Sua thao tac delete/clear:
   - `clearAllSessions` chi xoa session cua current user.
   - `deleteAllFiles` chi xoa file current user duoc phep xoa.
   - Xoa chunks theo `sourceFileId` va owner.

4. Migration:
   - Viet script gan `ownerId` cho document cu neu co the suy tu `uploadedBy`/`userId`.
   - Document khong xac dinh owner dua vao quarantine hoac admin-only.

### Tieu chi done

- User A khong thay chat/file/report cua User B.
- `clear all` cua User A khong tac dong User B.
- RAG khong lay context tu file khong duoc phep.

## Cum 5: AI/RAG va do tin cay so lieu

### Loi hien tai

- Embedding fail tra zero-vector, search co the mat nghia.
- Fallback AI/mock van tra noi dung co ve thanh cong.
- Parser tu suy profit/seller/region khi thieu du lieu.
- Model setting UI khong dieu khien backend.
- Toggle vector UI khong dieu khien service.

### File lien quan

- `server.ts`
- `src/services/embeddingService.ts`
- `src/services/ragService.ts`
- `src/services/vectorSearch.ts`
- `src/utils/salesParser.ts`
- `src/pages/Chat.tsx`
- `src/pages/Settings.tsx`

### Huong fix step by step

1. Sua embedding fallback:
   - Neu khong co API key hoac rate limit, tra error/warning ro.
   - Khong luu zero-vector vao Firestore nhu embedding hop le.
   - File co embedding fail phai `embeddingStatus: FAILED` hoac `PARTIAL`.

2. Sua RAG confidence:
   - Neu query vector fail, tra message "khong the truy xuat vector luc nay" va cho keyword fallback co nhan ro.
   - Ket qua keyword fallback can hien nhan "keyword fallback", khong gia lap semantic score.
   - Khong dung context cua file ngoai quyen.

3. Sua parser:
   - Neu thieu `profit`, de `profit = null` hoac flag `isEstimatedProfit`.
   - Neu tu suy seller/region, them flag `isEstimatedSeller`, `isEstimatedRegion`.
   - Report/chat phai phan biet so lieu that va so lieu uoc tinh.

4. Sua config model:
   - Backend doc `modelName` tu server config.
   - `generateContentWithFallback` uu tien model duoc cau hinh, sau do moi fallback.
   - UI hien dung model server dang su dung.

5. Sua toggle vector:
   - Truyen `useVector` vao `queryRAG`.
   - Neu false, bo qua embedding/searchChunks va dung keyword/live summary mode co nhan ro.

6. Sua simulated success:
   - Email/report scheduler neu simulated phai tra status rieng, UI hien "mo phong" thay vi "gui thanh cong".
   - Khong luu report mock nhu report san xuat neu khong co du lieu that.

### Tieu chi done

- Khong co report nao dung so uoc tinh ma khong gan nhan.
- RAG fail embedding thi user thay canh bao ro.
- Toggle vector thuc su thay doi pipeline.
- Model trong Settings anh huong request backend.

## Cum 6: Upload, ingestion va tinh nhat quan trang thai

### Loi hien tai

- Upload chi lay toi da 5.000 dong, nhung thong bao/luong subcollection co doan slice 10.000 gay nham lan.
- File duoc set `embeddingStatus: READY` truoc khi ingestion xong.
- Background task fail nhung UI co the van bao thanh cong.

### File lien quan

- `src/pages/DataManagement.tsx`
- `src/pages/Dashboard.tsx`
- `src/services/ragService.ts`
- `src/lib/fileStorage.ts`

### Huong fix step by step

1. Dinh nghia state lifecycle:
   - `PENDING_UPLOAD`
   - `UPLOADED`
   - `INGESTING`
   - `READY`
   - `FAILED`
   - `PARTIAL`

2. Khi upload:
   - Tao file voi `status: PROCESSING`, `embeddingStatus: PROCESSING`.
   - Luu records xong moi cap nhat `status: COMPLETED`.
   - Ingest chunks xong moi cap nhat `embeddingStatus: READY`.

3. Neu background task fail:
   - Luu `lastError`, `failedAt`, `retryCount`.
   - UI hien nut retry.
   - Khong hien file nhu da san sang cho RAG.

4. Chuan hoa gioi han record:
   - Dat constant `MAX_UPLOAD_RECORDS = 5000`.
   - Dung constant nay o upload, local storage, subcollection, UI message.

5. Kiem tra batch Firestore:
   - Dung batch toi da 500 writes.
   - Neu xoa nhieu docs, lap batch theo chunk.

### Tieu chi done

- File chi hien `READY` khi chunk/embedding da tao xong.
- Ingestion fail co thong bao va co retry.
- Khong co con so 5.000/10.000 mau thuan trong code.

## Cum 7: XSS, Markdown va HTML export/print

### Loi hien tai

- `ReactMarkdown` dung `rehypeRaw`, cho phep render raw HTML tu noi dung AI/report.
- `printElement` dua `element.innerHTML` vao document moi.
- Neu AI response hoac du lieu dau vao co script/event handler/doc HTML doc hai, co nguy co XSS.

### File lien quan

- `src/pages/Chat.tsx`
- `src/pages/Reports.tsx`
- `src/lib/utils.ts`

### Huong fix step by step

1. Mac dinh bo `rehypeRaw` neu khong that su can HTML.
2. Neu can raw HTML:
   - Dung `rehype-sanitize` voi schema whitelist.
   - Cam `script`, `iframe`, event handler `on*`, `style` nguy hiem, URL `javascript:`.
3. Truoc khi print/export:
   - Sanitize HTML bang DOMPurify hoac render lai tu data an toan.
   - Escape `title`.
4. Them test XSS mau:
   - Markdown chua `<img src=x onerror=alert(1)>`.
   - Link `javascript:alert(1)`.

### Tieu chi done

- HTML doc hai khong chay trong chat/report/print.
- Van render duoc markdown table, math, code block can thiet.

## Cum 8: Encoding tieng Viet va noi dung hien thi

### Loi hien tai

- Nhieu chuoi hien thi/prompt/email bi mojibake, vi du `ÄÄƒng nháº­p`.
- Loi nay anh huong UI, email, prompt AI, report va chat.

### File lien quan

- Gan nhu toan bo `src/**/*.tsx`, `src/**/*.ts`, `server.ts`
- `src/utils/salesParser.ts`
- `src/lib/fileStorage.ts`

### Huong fix step by step

1. Chot encoding:
   - Tat ca source code luu UTF-8.
   - EditorConfig/VS Code setting neu can.

2. Tao danh sach file bi mojibake:
   - Search cac token `Ä`, `áº`, `Ã`, `Æ`, `ðŸ`.
   - Phan loai: UI text, prompt AI, sample data, comment.

3. Sua theo cum:
   - UI text: sua truc tiep.
   - Prompt AI/email: sua rat can than vi anh huong dau ra.
   - Sample data: can quyet dinh giu sample hay generate lai.

4. Them guard:
   - Lint/check script fail neu file co pattern mojibake moi.

### Tieu chi done

- UI hien dung tieng Viet.
- Email/report/prompt khong con chuoi loi ma hoa.
- Search pattern mojibake tra ve 0 hoac danh sach chap nhan co giai thich.

## Cum 9: Build production, deploy va hieu nang

### Loi hien tai

- Build pass nhung co canh bao `import.meta` khi bundle server thanh CJS.
- Frontend chunk lon hon 3 MB sau minify.
- `dist/` sinh ra sau build nhung khong co trong `.gitignore`.

### File lien quan

- `package.json`
- `server.ts`
- `app.js`
- `vite.config.ts`
- `.gitignore`

### Huong fix step by step

1. Sua server bundle:
   - Cach A: build server thanh ESM va chay ESM thong nhat.
   - Cach B: neu giu CJS, bo logic phu thuoc `import.meta` trong source bundled.
   - Verify `app.js` import/chay dung voi output moi.

2. Them `dist/` vao `.gitignore` neu build artifact khong commit.

3. Giam frontend bundle:
   - Dynamic import cac page lon: Dashboard, Reports, Chat.
   - Lazy load chart/pdf/xlsx/html2canvas/jsPDF.
   - Cau hinh manualChunks neu can.

4. Verify:
   - `npm run build`
   - `npm run start`
   - Test API health va SPA route fallback.

### Tieu chi done

- Build khong con warning `import.meta`/CJS.
- Chunk chinh giam dang ke hoac co code-splitting.
- `dist/` khong lam ban git status sau build neu khong commit artifact.

## Thu tu trien khai de giam rui ro

1. Tao branch rieng: `codex/fix-security-data-risks`.
2. Fix Cum 1 va Cum 2 truoc, vi day la lop bao mat nen tang.
3. Fix Cum 3 va Cum 4 de role/owner dung that.
4. Fix Cum 6 de trang thai du lieu khong noi doi nguoi dung.
5. Fix Cum 5 de AI/RAG khong tao ket qua sai ma khong canh bao.
6. Fix Cum 7 de dong XSS.
7. Fix Cum 8 de sua hien thi tieng Viet.
8. Fix Cum 9 de san sang deploy.

## Checklist verify cuoi cung

- `npm install`
- `npm run lint`
- `npm run build`
- Firestore rules tests pass tren emulator.
- Test bang 3 tai khoan voi 3 role.
- User A khong thay/xoa du lieu User B.
- API khong token bi 401, sai role bi 403.
- Upload file moi: status di qua `PROCESSING` roi moi `READY`.
- Tat Gemini key hoac gia lap rate limit: UI hien canh bao, khong ghi zero-vector nhu thanh cong.
- Chat/report khong render raw HTML nguy hiem.
- Search mojibake pattern khong con trong UI/prompt quan trong.

## Trang thai trien khai ngay hien tai

Da thuc hien:

- Khoa `firestore.rules`, thay rule mo toan bo bang rule theo `ownerId/userId/createdBy` va role `SYSTEM_ADMIN`.
- Bo default `SYSTEM_ADMIN` trong `AuthContext`; demo auth chi chay khi `VITE_ENABLE_DEMO_AUTH=true`.
- User moi qua Login/Register duoc tao mac dinh `SALES_MANAGER`, khong con tao admin mac dinh.
- Them Firebase Admin Auth cho backend va middleware token cho `/api/*`, tru `/api/health`.
- Khoa `/api/config` va `/api/trigger-daily-scheduler` cho `SYSTEM_ADMIN`; `/api/send-email` can role hop le.
- Them `authenticatedFetch` de frontend gui Firebase ID token khi goi API.
- Loai bo viec client gui Gemini API key trong body request chat/analyze/embedding.
- Backend dung Firebase Admin Firestore cho cac API/scheduler server-side.
- Scope cac luong chinh `Chat`, `DataManagement`, `Dashboard`, `Reports` theo owner hien tai.
- Them `ownerId/createdBy` cho files, reports, insights, knowledge chunks va chat sessions moi.
- RAG/vector search co the loc theo `ownerId`.
- Embedding khong con tra zero-vector khi loi API key/quota; ingestion bi danh dau `FAILED` thay vi ghi vector gia.
- Markdown trong Chat/Reports duoc sanitize bang `rehype-sanitize`.
- SMTP khong tat verify TLS mac dinh; chi cho phep insecure TLS neu bat `SMTP_ALLOW_INSECURE_TLS=true`.
- Backend build doi sang ESM de het warning `import.meta` voi CommonJS.
- Them `dist/` vao `.gitignore`.

Da verify:

- `npm run lint` pass.
- `npm run build` pass.

Con ton dong nen lam tiep:

- Chay Firestore rules tests tren emulator va cap nhat test setup role day du.
- Dọn sach doan fallback auto-register cu trong `Login.tsx`; hien da bi `return` chan nhung nen xoa han khoi source.
- Xoa luu secret `gemini_custom_api_key` va `sales_smtp_pass` trong `localStorage`, thay bang luu server-side/encrypted.
- Hoan tat lifecycle upload `PROCESSING -> READY/FAILED` o moi UI; hien da chặn vector gia nhung UI van co mot so message cu.
- Sua mojibake tieng Viet tren toan bo source.
- Code-split frontend de giam bundle lon hon 500 kB.

## Cap nhat: fix demo van thay du lieu cu

Nhom loi:

- Demo session cu duoc restore lai sau reload, nen khach moi tren cung trinh duyet co the thay lai data cua khach truoc.
- Demo van co duong dong bo local data len Firestore va cac man hinh van lang nghe Firestore theo `demo_*`.
- File mau mac dinh 5000 dong bi tron vao danh sach file nhu du lieu that, lam nguoi dung tuong la data cu van duoc luu.

Cach fix da trien khai:

- Doi active demo sang session co `demoIsolationVersion`; cac demo session cu khong co version se bi huy sau reload.
- Khi bat dau demo moi, xoa cac key demo trong `sessionStorage` hien tai va cac key demo cu trong `localStorage`.
- Chat/file/report local cua demo chi dung `sessionStorage`; khong sync len Firestore.
- Cac man `Chat`, `DataManagement`, `Dashboard`, `Reports` khi o demo se doc/ghi local theo phien, khong nghe Firestore.
- `mergeFiles` khong tu chen file mau 5000 dong vao danh sach file that khi dang la demo; Dashboard van co che do du lieu mau rieng de khach trai nghiem khi chua upload file.
- Dashboard demo moi khong tu bat du lieu mo phong 12 dong nua; neu khach chua upload file thi se la trang thai trong that.

Verify:

- `npm run lint` pass.
- `npm run build` pass.
- Ban build moi dang chay tai `http://localhost:6612`.

## Cap nhat: fix/chan doan AI khong hoat dong tren host

Nguyen nhan kha nang cao:

- Backend tren host khong doc duoc `GEMINI_API_KEY`; local health hien `geminiConfigured:false`, `geminiKeySource:"missing"`.
- README cu chi noi `.env.local`, trong khi server/app truoc do chu yeu load `.env`, nen deploy host de bi thieu key neu chi upload `.env.local` hoac chi luu key trong browser.
- `/api/chat` truoc day che loi thieu key bang cau fallback "Google qua tai", lam kho nhan biet loi cau hinh that.

Cach fix da trien khai:

- `app.js` va `server.ts` doc ca `.env` lan `.env.local`.
- `/api/health` tra them `geminiKeySource` va `authVerifierConfigured`.
- Khi thieu key, `/api/chat`, `/api/analyze`, `/api/embeddings`, `/api/data-quality-check` tra `MissingApiKey`/503 ro rang thay vi fallback gay hieu nham.
- Frontend `chatWithAI/analyzeData` doc message loi tu server de hien dung nguyen nhan.
- README them checklist deploy: `GEMINI_API_KEY`, `authVerifierConfigured`, `FIREBASE_SERVICE_ACCOUNT_JSON`.

Verify:

- `npm run lint` pass.
- `npm run build` pass.
- `http://localhost:6612/api/health` tra `geminiConfigured:false`, `geminiKeySource:"missing"` khi chua set key, dung voi ky vong chan doan.
