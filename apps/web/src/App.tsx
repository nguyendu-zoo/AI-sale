import { useEffect, useState } from 'react';
import { Alert, App as AntApp, Avatar, Badge, Button, Empty, Layout, Menu, Select, Space, Spin, Tag, Typography } from 'antd';
import { AuditOutlined, BellOutlined, CommentOutlined, DownOutlined, ExportOutlined, FacebookFilled, LogoutOutlined, MenuOutlined, ReloadOutlined, RobotOutlined, SettingOutlined, ShoppingOutlined, TeamOutlined } from '@ant-design/icons';
import { io } from 'socket.io-client';
import { api, errorMessage, post } from './api';
import { AuthScreen, VerifyEmail } from './AuthScreen';
import { Inbox } from './Inbox';
import { AuditView, NotificationsView, PageSettingsView, ProductsView, UsersView } from './Management';
import type { Health, Page, User } from './types';

const { Sider, Header, Content } = Layout;
const { Text, Title } = Typography;
type View = 'inbox' | 'products' | 'notifications' | 'pages' | 'users' | 'audit';
const labels: Record<View, string> = { inbox: 'Trung tâm hội thoại', products: 'Danh mục sản phẩm', notifications: 'Thông báo & chuyển tiếp', pages: 'Fanpage & kết nối', users: 'Nhân viên & phân quyền', audit: 'Nhật ký hoạt động' };

export default function App() {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(true);
  const [verify, setVerify] = useState(window.location.pathname === '/verify-email');
  useEffect(() => {
    let active = true;
    api<{ user: User }>('/auth/me').then((result) => { if (active) setUser(result.user); }).catch(() => {}).finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, []);
  if (verify) return <VerifyEmail onDone={() => { window.history.replaceState({}, '', '/'); setVerify(false); }} />;
  if (loading) return <div className="center-screen"><Spin size="large" tip="Đang mở không gian làm việc…"><div className="spinner-space" /></Spin></div>;
  if (!user) return <AuthScreen onLogin={setUser} />;
  return <Workspace user={user} onLogout={() => setUser(null)} />;
}

function Workspace({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>('inbox');
  const [pages, setPages] = useState<Page[]>([]);
  const [pageId, setPageId] = useState(new URLSearchParams(window.location.search).get('pageId') || '');
  const [health, setHealth] = useState<Health | null>(null);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(true);
  const [refresh, setRefresh] = useState(0);
  const [collapsed, setCollapsed] = useState(false);
  const [realtime, setRealtime] = useState(false);
  const { message } = AntApp.useApp();
  const admin = user.role === 'SUPER_ADMIN';
  const page = pages.find((item) => item.id === pageId);
  useEffect(() => {
    let active = true;
    setBusy(true);
    api<Page[]>('/pages').then((items) => {
      if (!active) return;
      setPages(items); setError('');
      setPageId((selected) => items.some((item) => item.id === selected) ? selected : items[0]?.id || '');
    }).catch((err) => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setBusy(false); });
    api<Health>('/health').then((result) => { if (active) setHealth(result); }).catch(() => {});
    return () => { active = false; };
  }, [refresh]);
  useEffect(() => {
    if (!pageId) return;
    const socket = io({ withCredentials: true, transports: ['websocket', 'polling'] });
    socket.on('connect', () => { setRealtime(true); socket.emit('join_page', { pageId }); });
    socket.on('disconnect', () => setRealtime(false));
    socket.on('connect_error', () => setRealtime(false));
    socket.on('page_update', () => setRefresh((count) => count + 1));
    socket.on('access_revoked', () => { setRefresh((count) => count + 1); void message.warning('Quyền truy cập Fanpage đã được cập nhật.'); });
    return () => { socket.disconnect(); setRealtime(false); };
  }, [pageId, message]);
  const reload = () => setRefresh((count) => count + 1);
  const logout = async () => { try { await post('/auth/logout'); onLogout(); } catch (err) { void message.error(errorMessage(err)); } };
  const mode = health?.mode || health?.integrationsMode;
  const items = [
    { key: 'inbox', icon: <CommentOutlined />, label: 'Hội thoại' },
    { key: 'products', icon: <ShoppingOutlined />, label: 'Sản phẩm' },
    { key: 'notifications', icon: <BellOutlined />, label: 'Thông báo' },
    ...(admin ? [ { type: 'divider' as const }, { key: 'pages', icon: <FacebookFilled />, label: 'Fanpage & kết nối' }, { key: 'users', icon: <TeamOutlined />, label: 'Nhân viên' }, { key: 'audit', icon: <AuditOutlined />, label: 'Nhật ký hoạt động' } ] : []),
  ];
  return <Layout className="workspace">
    <Sider width={242} collapsedWidth={74} collapsed={collapsed} className="sidebar" theme="dark">
      <div className="brand"><span className="brand-mark"><RobotOutlined /></span>{!collapsed && <span>AI Sales Agent<small>WORKSPACE</small></span>}</div>
      {!collapsed && <div className="sidebar-caption">KHÔNG GIAN LÀM VIỆC</div>}
      <Menu theme="dark" mode="inline" selectedKeys={[view]} items={items} onClick={({ key }) => setView(key as View)} />
      {!collapsed && <div className="sidebar-advice"><span className="advice-spark">✦</span><strong>AI đồng hành cùng bạn</strong><p>Tư vấn trong giới hạn giá. Chuyển nhân viên khi khách cần.</p><Tag color="orange">Nhân viên luôn kiểm soát</Tag></div>}
      <div className="sidebar-user"><Avatar style={{ backgroundColor: '#385064' }}>{user.name.slice(0, 1).toUpperCase()}</Avatar>{!collapsed && <div><strong>{user.name}</strong><small>{admin ? 'Super Admin' : 'Nhân viên Fanpage'}</small></div>}<Button type="text" icon={<LogoutOutlined />} aria-label="Đăng xuất" onClick={() => { void logout(); }} /></div>
    </Sider>
    <Layout className="main-layout">
      <Header className="workspace-header"><Space size={14}><Button type="text" icon={<MenuOutlined />} onClick={() => setCollapsed(!collapsed)} aria-label="Thu gọn menu" /><div className="header-breadcrumb">Không gian làm việc <span>/</span> <strong>{labels[view]}</strong></div></Space><Space size={16}><Badge status={realtime ? 'success' : 'default'} text={realtime ? 'Đang cập nhật' : 'Chưa có realtime'} /><Avatar className="header-avatar">{user.name.slice(0, 1).toUpperCase()}</Avatar></Space></Header>
      <Content className="workspace-content">
        <div className="page-heading"><div><div className="eyebrow">TƯ VẤN TẬN TÂM · PHỐI HỢP HIỆU QUẢ</div><Title level={2}>{labels[view]}</Title><Text type="secondary">{view === 'inbox' ? 'Một nơi để lắng nghe khách hàng và tiếp nối mọi cuộc trò chuyện.' : 'Quản lý thông tin, kết nối và vận hành các Fanpage của bạn.'}</Text></div><Space className="page-tools"><Select aria-label="Chọn Fanpage" value={pageId || undefined} placeholder="Chọn Fanpage" options={pages.map((item) => ({ label: item.name, value: item.id }))} onChange={setPageId} suffixIcon={<DownOutlined />} style={{ minWidth: 180 }} /><Button icon={<ReloadOutlined />} aria-label="Làm mới" onClick={reload} /></Space></div>
        {mode && <Alert className="environment-banner" type={mode === 'mock' ? 'warning' : 'info'} showIcon message={mode === 'mock' ? 'Chế độ demo local — Messenger, Google Sheets, OpenAI và Telegram đang dùng bộ mô phỏng; chưa kết nối tài khoản thật.' : 'Chế độ tích hợp thật — trạng thái cấu hình và lỗi đồng bộ hiển thị theo từng Fanpage.'} />}
        {error && <Alert className="form-alert" type="error" showIcon message={error} action={<Button onClick={reload}>Thử lại</Button>} />}
        {!user.emailVerifiedAt && <Alert type="warning" showIcon message="Tài khoản chưa xác thực email. Hãy kiểm tra hộp thư trước khi truy cập Fanpage." className="form-alert" />}
        {busy && !pages.length ? <div className="loading-panel"><Spin /></div> : !pages.length && view !== 'pages' && view !== 'users' && view !== 'audit' ? <div className="empty-workspace"><Empty description={admin ? 'Chưa có Fanpage. Tạo Fanpage đầu tiên để bắt đầu.' : 'Bạn chưa được cấp quyền Fanpage. Liên hệ Super Admin để được phân công.'} />{admin && <Button type="primary" onClick={() => setView('pages')} icon={<SettingOutlined />}>Quản lý Fanpage</Button>}</div> : <>
          {view === 'inbox' && page && <Inbox key={page.id} page={page} admin={admin} mode={mode} refresh={refresh} onChange={reload} />}
          {view === 'products' && page && <ProductsView page={page} refresh={refresh} admin={admin} onChange={reload} />}
          {view === 'notifications' && page && <NotificationsView page={page} refresh={refresh} />}
          {view === 'pages' && admin && <PageSettingsView pages={pages} selectedId={pageId} onChange={reload} />}
          {view === 'users' && admin && <UsersView pages={pages} refresh={refresh} onChange={reload} />}
          {view === 'audit' && admin && <AuditView pageId={pageId} refresh={refresh} />}
        </>}
        <footer className="workspace-footer"><span>AI Sales Agent · Tư vấn có kiểm soát, khách hàng được lắng nghe.</span><a href="/api/docs" target="_blank" rel="noreferrer">Tài liệu API <ExportOutlined /></a></footer>
      </Content>
    </Layout>
  </Layout>;
}
