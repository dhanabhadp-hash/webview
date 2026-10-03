import { Link } from 'wouter';
import { AlertCircle, ArrowLeft } from 'lucide-react';

export default function NotFound() {
  return <main className="page not-found-page">
    <section className="error-state" aria-labelledby="not-found-title">
      <AlertCircle size={30} />
      <h1 id="not-found-title">ไม่พบหน้าที่ต้องการ</h1>
      <p>ตรวจสอบที่อยู่ หรือกลับไปยังทะเบียนจัดซื้อยา</p>
      <Link href="/" className="button button-primary"><ArrowLeft size={15} />กลับทะเบียนจัดซื้อ</Link>
    </section>
  </main>;
}