# Huong dan clone, build va chay project

Tai lieu nay danh cho nguoi moi clone source ve may rieng hoac dua len host.

## 1. Yeu cau moi truong

- Node.js 20 tro len, khuyen dung Node.js 22 hoac 24.
- npm di kem Node.js.
- Mot Firebase project da cau hinh Authentication va Firestore.
- Mot Gemini API key tu Google AI Studio neu muon dung cac tinh nang AI that.

Kiem tra nhanh:

```bash
node -v
npm -v
```

## 2. Clone source

```bash
git clone <repo-url>
cd <ten-thu-muc-project>
```

## 3. Cai dependencies

```bash
npm install
```

Neu gap loi dependency, xoa `node_modules` va cai lai:

```bash
rm -rf node_modules package-lock.json
npm install
```

Tren Windows PowerShell co the dung:

```powershell
Remove-Item -Recurse -Force node_modules
Remove-Item -Force package-lock.json
npm install
```

## 4. Tao file moi truong

Tao file `.env.local` hoac `.env` nam cung cap voi `app.js`.

Mau toi thieu:

```env
NODE_ENV=production
PORT=6612
GEMINI_API_KEY=your_gemini_api_key_here
```

Neu chay API can xac thuc Firebase tren server/host, them service account:

```env
FIREBASE_SERVICE_ACCOUNT_JSON={"type":"service_account","project_id":"..."}
```

Luu y:

- Khong commit `.env` hoac `.env.local` len git.
- `GEMINI_API_KEY` phai nam o server environment, khong chi luu trong trinh duyet.
- Sau deploy co the kiem tra bang `/api/health`.

## 5. Cau hinh Firebase client

Project dang doc Firebase client config tu file:

```text
firebase-applet-config.json
```

Dam bao file nay dung voi Firebase project cua ban. File can co cac thong tin nhu `apiKey`, `authDomain`, `projectId`, `appId`.

Firestore rules nam o:

```text
firestore.rules
```

Neu deploy Firebase rules, chay theo quy trinh Firebase CLI cua project ban.

## 6. Chay dev local

```bash
npm run dev
```

Mac dinh server dev se chay theo `server.ts`. Neu dat `PORT=6612`, mo:

```text
http://localhost:6612
```

## 7. Kiem tra type/lint

```bash
npm run lint
```

Lenh nay chay TypeScript check bang `tsc --noEmit`.

## 8. Build production

```bash
npm run build
```

Lenh build se tao:

- Frontend Vite trong `dist/`.
- Backend bundle ESM tai `dist/server.js`.

## 9. Chay production local

```bash
npm run start
```

Hoac:

```bash
node app.js
```

Mac dinh `app.js` dat:

```text
NODE_ENV=production
PORT=6612
```

Mo:

```text
http://localhost:6612
```

## 10. Kiem tra sau khi chay

Mo health endpoint:

```text
http://localhost:6612/api/health
```

Ket qua tot nen co:

```json
{
  "status": "ok",
  "geminiConfigured": true,
  "geminiKeySource": "env",
  "firebaseConfigured": true,
  "authVerifierConfigured": true
}
```

Neu `geminiConfigured` la `false`:

- Server chua doc duoc `GEMINI_API_KEY`.
- Kiem tra `.env`, `.env.local`, hoac bien moi truong tren host.
- Restart server sau khi them key.

Neu `authVerifierConfigured` la `false`:

- Server chua co Firebase Admin credential.
- Them `FIREBASE_SERVICE_ACCOUNT_JSON` vao bien moi truong host.

## 11. Deploy len host/Plesk/Passenger

Quy trinh goi y:

1. Upload source len host.
2. Chay `npm install`.
3. Tao bien moi truong tren host:
   - `NODE_ENV=production`
   - `PORT=<port host cap>`
   - `GEMINI_API_KEY=<key that>`
   - `FIREBASE_SERVICE_ACCOUNT_JSON=<service account json>` neu can user auth that.
4. Chay `npm run build`.
5. Cau hinh entry point la:

```text
app.js
```

6. Restart app tren host.
7. Mo `/api/health` de kiem tra.

## 12. Lenh thuong dung

```bash
npm install
npm run lint
npm run build
npm run start
```

## 13. Loi thuong gap

### AI khong hoat dong

Kiem tra:

```text
/api/health
```

Neu thay:

```json
"geminiConfigured": false
```

Thi server dang thieu `GEMINI_API_KEY`.

### API tra Unauthorized hoac AuthVerifierUnavailable

Kiem tra:

```json
"authVerifierConfigured": false
```

Neu false, them `FIREBASE_SERVICE_ACCOUNT_JSON` tren host.

### Build thanh cong nhung mo route bi 404

Dam bao dang chay `node app.js`, khong chi serve rieng folder `dist`. Backend Express trong `app.js` co SPA fallback cho React Router.

### Port bi trung

Doi bien moi truong:

```env
PORT=6613
```

Sau do restart server.

## 14. Checklist truoc khi ban giao

- `npm run lint` pass.
- `npm run build` pass.
- `/api/health` tra `status: ok`.
- `geminiConfigured: true` neu can AI that.
- Dang nhap/demo hoat dong.
- Chat AI goi duoc `/api/chat`.
- Upload file va dashboard hien dung du lieu.
