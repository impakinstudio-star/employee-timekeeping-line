# Deploy บน Render Free

## 1. เตรียม repository

เอาโฟลเดอร์นี้ขึ้น GitHub:

```text
employee-timekeeping-app
```

ไฟล์สำคัญที่ต้องมี:

```text
server.js
app.js
index.html
styles.css
package.json
render.yaml
LINE_SETUP.md
```

ไม่ควรเอาไฟล์ `data.json` ขึ้น repo เพราะมีข้อมูลพนักงาน ค่าแรง และ LINE user ID

## 2. สร้าง Web Service ใน Render

1. เข้า Render Dashboard
2. เลือก New > Web Service
3. Connect GitHub repository
4. ตั้งค่า:

```text
Runtime: Node
Build Command: npm install
Start Command: npm start
Plan: Free
```

ถ้า Render ถาม Root Directory ให้ใส่:

```text
outputs/employee-timekeeping-app
```

ถ้าเอาเฉพาะโฟลเดอร์นี้ขึ้น GitHub เป็น repo ใหม่ ไม่ต้องใส่ Root Directory

## 3. Environment Variables

ตั้งค่าใน Render > Environment:

```text
MANAGER_USER=manager
MANAGER_PASSWORD=ตั้งรหัสผ่านจริง
LINE_CHANNEL_SECRET=ค่าจาก LINE Developers
LINE_CHANNEL_ACCESS_TOKEN=ค่าจาก LINE Developers
NODE_ENV=production
```

Render จะกำหนด `PORT` ให้เอง ไม่ต้องตั้งเอง

## 4. ตั้งค่า LINE Webhook

หลัง deploy แล้ว Render จะให้ URL เช่น:

```text
https://employee-timekeeping-line.onrender.com
```

นำไปตั้งใน LINE Developers เป็น:

```text
https://employee-timekeeping-line.onrender.com/webhook
```

จากนั้นกด Verify และเปิด Use webhook

## 5. ข้อควรรู้ของ Free plan

- Free service อาจ sleep เมื่อไม่มีคนใช้งาน
- ครั้งแรกหลัง sleep อาจเปิดช้าหน่อย
- ไฟล์ `data.json` บน Render Free อาจไม่เหมาะกับข้อมูลระยะยาวหลัง redeploy
- ถ้าใช้งานจริงระยะยาว ควรเปลี่ยนเป็นฐานข้อมูล เช่น PostgreSQL
