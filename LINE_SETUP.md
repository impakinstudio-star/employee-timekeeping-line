# ตั้งค่า LINE Messaging API

ระบบนี้มี webhook อยู่ที่:

```text
/webhook/line
```

เมื่อต่อใช้งานจริง Webhook URL ต้องเป็น HTTPS เช่น:

```text
https://your-domain.com/webhook/line
```

## สิ่งที่ต้องมีจาก LINE

1. LINE Official Account
2. Messaging API channel
3. Channel secret
4. Channel access token
5. HTTPS URL ของระบบ

## Environment variables

ตอนเปิดระบบจริงให้ตั้งค่า:

```powershell
$env:LINE_CHANNEL_SECRET='channel-secret-from-line'
$env:LINE_CHANNEL_ACCESS_TOKEN='channel-access-token-from-line'
$env:MANAGER_USER='manager'
$env:MANAGER_PASSWORD='your-strong-password'
$env:PORT='8132'
node server.js
```

## ตั้งค่าใน LINE Developers Console

1. เข้า LINE Developers Console
2. เลือก Provider และ Messaging API channel
3. ไปที่แท็บ Messaging API
4. ใส่ Webhook URL เป็น `https://your-domain.com/webhook/line`
5. กด Verify
6. เปิด Use webhook
7. แนะนำให้ปิด Auto-reply messages ถ้าต้องการให้ระบบนี้ตอบเอง

## การผูกพนักงานกับ LINE

1. เพิ่ม LINE Official Account เข้ากลุ่ม LINE ที่ใช้งาน
2. ให้พนักงานพิมพ์ `เข้างาน`
3. ถ้ายังไม่เคยผูก ระบบจะเก็บ LINE user ID ไว้ในหน้า “LINE ที่รอผูกกับพนักงาน”
4. ผู้จัดการเปิดหน้าพนักงาน เลือกชื่อพนักงาน แล้วกด “ผูก LINE”
5. หลังจากผูกแล้ว พนักงานใช้คำสั่งได้ทันที

## คำสั่งที่รองรับ

```text
เข้างาน
ออกงาน
ลา วันนี้
หยุด วันนี้
สรุปของฉัน
```

## หมายเหตุ

- ถ้าไม่ได้ตั้ง `LINE_CHANNEL_ACCESS_TOKEN` ระบบยังรับ webhook และบันทึกข้อมูลได้ แต่จะไม่ตอบกลับใน LINE
- ถ้าไม่ได้ตั้ง `LINE_CHANNEL_SECRET` ระบบจะไม่ตรวจ signature เหมาะเฉพาะการทดสอบในเครื่อง
- ใช้งานจริงควรตั้งทั้งสองค่า
