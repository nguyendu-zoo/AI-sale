import { useEffect, useState } from 'react';
import { Alert, App, Button, Card, Form, Input, Space, Spin, Typography } from 'antd';
import { ArrowRightOutlined, MailOutlined, RobotOutlined, SafetyCertificateOutlined } from '@ant-design/icons';
import { errorMessage, post } from './api';
import type { User } from './types';

const { Title, Paragraph, Text } = Typography;

export function AuthScreen({ onLogin }: { onLogin: (user: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'resend'>('login');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const { message } = App.useApp();

  async function submit(values: { name?: string; email: string; password?: string }) {
    setBusy(true); setError(''); setNotice('');
    try {
      if (mode === 'login') {
        const result = await post<{ user: User }>('/auth/login', values);
        onLogin(result.user);
      } else if (mode === 'register') {
        const result = await post<{ message: string }>('/auth/register', values);
        setNotice(result.message || 'Đăng ký thành công. Hãy mở email xác thực trước khi đăng nhập.');
        setMode('login');
        void message.success('Tài khoản đã được tạo. Vui lòng xác thực email.');
      } else {
        const result = await post<{ message: string }>('/auth/resend-verification', { email: values.email });
        setNotice(result.message || 'Nếu tài khoản tồn tại và chưa xác thực, email mới sẽ được gửi.');
      }
    } catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  }

  const switchMode = (value: typeof mode) => { setMode(value); setError(''); setNotice(''); };
  return <div className="auth-layout">
    <aside className="auth-story">
      <div className="brand brand-large"><span className="brand-mark"><RobotOutlined /></span><span>AI Sales Agent<small>KHÔNG GIAN LÀM VIỆC</small></span></div>
      <div className="auth-story-content"><div className="eyebrow">BÁN HÀNG BẰNG SỰ THẤU HIỂU</div><h1>Mọi hội thoại.<br />Một trải nghiệm<br /><em>tận tâm.</em></h1><p>Kết nối các Fanpage, tư vấn đúng sản phẩm và cùng nhân viên chăm sóc khách hàng đúng lúc.</p><div className="auth-note"><SafetyCertificateOutlined /><span>Giá được kiểm soát. Quyền truy cập theo Fanpage.<br />Nhân viên luôn có thể tiếp quản.</span></div></div>
      <span className="auth-footer">Được thiết kế cho những thương hiệu có câu chuyện riêng.</span>
    </aside>
    <main className="auth-main"><Card className="auth-card" bordered={false}>
      <Text className="eyebrow">CHÀO MỪNG BẠN</Text>
      <Title level={2}>{mode === 'login' ? 'Đăng nhập không gian làm việc' : mode === 'register' ? 'Tạo tài khoản của bạn' : 'Gửi lại email xác thực'}</Title>
      <Paragraph type="secondary">{mode === 'register' ? 'Sau khi xác thực email, quản trị viên sẽ cấp quyền Fanpage cho bạn.' : 'Quản lý hội thoại và phối hợp cùng AI trong một nơi.'}</Paragraph>
      {error && <Alert role="alert" type="error" showIcon message={error} className="form-alert" />}
      {notice && <Alert type="success" showIcon message={notice} className="form-alert" />}
      <Form key={mode} layout="vertical" onFinish={(values) => { void submit(values); }} requiredMark={false}>
        {mode === 'register' && <Form.Item label="Họ và tên" name="name" rules={[{ required: true, message: 'Nhập họ và tên.' }, { min: 2, max: 100 }]}><Input autoComplete="name" placeholder="Tên của bạn" /></Form.Item>}
        <Form.Item label="Email" name="email" rules={[{ required: true, message: 'Nhập email.' }, { type: 'email', message: 'Email chưa đúng định dạng.' }]}><Input prefix={<MailOutlined />} type="email" autoComplete="email" placeholder="ban@thuonghieu.vn" /></Form.Item>
        {mode !== 'resend' && <Form.Item label="Mật khẩu" name="password" rules={[{ required: true, message: 'Nhập mật khẩu.' }, { min: 12, max: 72, message: 'Mật khẩu cần từ 12 đến 72 ký tự.' }, { validator: (_, value: string) => !value || new TextEncoder().encode(value).length <= 72 ? Promise.resolve() : Promise.reject(new Error('Mật khẩu tối đa 72 byte UTF-8.')) }]}><Input.Password autoComplete={mode === 'register' ? 'new-password' : 'current-password'} placeholder={mode === 'register' ? 'Ít nhất 12 ký tự' : 'Mật khẩu của bạn'} /></Form.Item>}
        <Button type="primary" htmlType="submit" block loading={busy} icon={<ArrowRightOutlined />} iconPosition="end">{mode === 'login' ? 'Đăng nhập' : mode === 'register' ? 'Tạo tài khoản' : 'Gửi email xác thực'}</Button>
      </Form>
      <div className="auth-links"><Space direction="vertical" size={4}>
        <Text type="secondary">{mode === 'login' ? 'Bạn chưa có tài khoản?' : 'Bạn đã có tài khoản?'} <Button type="link" onClick={() => switchMode(mode === 'login' ? 'register' : 'login')}>{mode === 'login' ? 'Đăng ký' : 'Đăng nhập'}</Button></Text>
        {mode !== 'resend' && <Button type="text" size="small" onClick={() => switchMode('resend')}>Chưa nhận được email xác thực?</Button>}
      </Space></div>
    </Card></main>
  </div>;
}

export function VerifyEmail({ onDone }: { onDone: () => void }) {
  const token = new URLSearchParams(window.location.search).get('token');
  const [state, setState] = useState<'ready' | 'busy' | 'success' | 'error'>('ready');
  const [error, setError] = useState('');
  useEffect(() => { if (!token) { setError('Liên kết thiếu mã xác thực.'); setState('error'); } }, [token]);
  async function verify() {
    setState('busy');
    try { await post('/auth/verify-email', { token }); setState('success'); }
    catch (err) { setError(errorMessage(err)); setState('error'); }
  }
  return <div className="center-screen"><Card className="verify-card"><SafetyCertificateOutlined className="verify-icon" /><Title level={2}>Xác thực email</Title>
    {state === 'busy' ? <Spin /> : state === 'success' ? <Alert type="success" showIcon message="Email đã được xác thực. Bạn có thể đăng nhập." /> : state === 'error' ? <Alert type="error" showIcon message={error} /> : <Paragraph>Nhấn xác thực để hoàn tất đăng ký và bảo vệ tài khoản của bạn.</Paragraph>}
    <Space className="form-alert">{state === 'ready' && <Button type="primary" onClick={() => { void verify(); }}>Xác thực email</Button>}<Button onClick={onDone}>Đến trang đăng nhập</Button></Space>
  </Card></div>;
}
