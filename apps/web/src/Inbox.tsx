import { useEffect, useMemo, useRef, useState } from 'react';
import { Alert, App, Avatar, Badge, Button, Empty, Form, Input, Modal, Select, Space, Spin, Switch, Tag, Tooltip, Typography } from 'antd';
import { ArrowRightOutlined, CheckCircleOutlined, ClockCircleOutlined, CommentOutlined, ExperimentOutlined, RobotOutlined, SearchOutlined, SendOutlined, UserOutlined } from '@ant-design/icons';
import { api, dateTime, errorMessage, money, patch, post } from './api';
import type { Conversation, Page, Status } from './types';

const { Text, Title } = Typography;
export const statusLabels: Record<Status, string> = { AI_ACTIVE: 'AI đang tư vấn', NEEDS_HUMAN: 'Cần nhân viên', TAKEN_OVER: 'Đã tiếp quản', WAITING_CONFIRMATION: 'Chờ xác nhận' };
const statusColors: Record<Status, string> = { AI_ACTIVE: 'green', NEEDS_HUMAN: 'orange', TAKEN_OVER: 'blue', WAITING_CONFIRMATION: 'purple' };

export function Inbox({ page, admin, mode, refresh, onChange }: { page: Page; admin: boolean; mode?: string; refresh: number; onChange: () => void }) {
  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [selected, setSelected] = useState(new URLSearchParams(window.location.search).get('conversationId') || '');
  const [detail, setDetail] = useState<Conversation | null>(null);
  const [listBusy, setListBusy] = useState(true);
  const [detailBusy, setDetailBusy] = useState(false);
  const [error, setError] = useState('');
  const [detailError, setDetailError] = useState('');
  const [search, setSearch] = useState('');
  const [filter, setFilter] = useState<Status | 'ALL'>('ALL');
  const [reply, setReply] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const [simulatorOpen, setSimulatorOpen] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);
  const { message } = App.useApp();

  useEffect(() => {
    let active = true;
    setListBusy(true);
    api<Conversation[]>(`/pages/${page.id}/conversations`).then((items) => {
      if (!active) return;
      setConversations(items); setError('');
      setSelected((id) => items.some((item) => item.id === id) ? id : items[0]?.id || '');
    }).catch((err) => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setListBusy(false); });
    return () => { active = false; };
  }, [page.id, refresh]);

  useEffect(() => {
    if (!selected) { setDetail(null); return; }
    let active = true;
    setDetailBusy(true); setDetailError('');
    api<Conversation>(`/pages/${page.id}/conversations/${selected}`).then((item) => { if (active) setDetail(item); }).catch((err) => { if (active) { setDetail(null); setDetailError(errorMessage(err)); } }).finally(() => { if (active) setDetailBusy(false); });
    return () => { active = false; };
  }, [page.id, selected, refresh]);
  useEffect(() => { endRef.current?.scrollIntoView({ block: 'nearest', behavior: 'smooth' }); }, [detail?.messages?.length]);

  const filtered = useMemo(() => conversations.filter((item) => (filter === 'ALL' || item.status === filter) && `${item.customerName || ''} ${item.customerId} ${item.messages?.[0]?.text || ''}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi'))), [conversations, filter, search]);
  const stats = [
    { label: 'Tổng hội thoại', value: conversations.length, icon: <CommentOutlined />, color: 'orange', status: 'ALL' as const },
    { label: 'AI đang tư vấn', value: conversations.filter((item) => item.status === 'AI_ACTIVE').length, icon: <RobotOutlined />, color: 'green', status: 'AI_ACTIVE' as const },
    { label: 'Cần nhân viên', value: conversations.filter((item) => item.status === 'NEEDS_HUMAN').length, icon: <UserOutlined />, color: 'blue', status: 'NEEDS_HUMAN' as const },
    { label: 'Chờ xác nhận', value: conversations.filter((item) => item.status === 'WAITING_CONFIRMATION').length, icon: <ClockCircleOutlined />, color: 'purple', status: 'WAITING_CONFIRMATION' as const },
  ];

  async function act(action: () => Promise<unknown>, success: string) {
    setActionBusy(true);
    try { await action(); onChange(); void message.success(success); }
    catch (err) { void message.error(errorMessage(err)); }
    finally { setActionBusy(false); }
  }
  function selectConversation(id: string) {
    setSelected(id); setReply('');
    const url = new URL(window.location.href); url.searchParams.set('pageId', page.id); url.searchParams.set('conversationId', id); window.history.replaceState({}, '', url);
  }
  const quote = detail?.quotes?.[0];
  const canSend = !!detail?.lastCustomerMessageAt && Date.now() - new Date(detail.lastCustomerMessageAt).getTime() < 24 * 60 * 60 * 1000;
  const sendReply = () => {
    if (!reply.trim() || !detail) return;
    const text = reply.trim();
    void act(async () => { await post(`/pages/${page.id}/conversations/${detail.id}/reply`, { text }); setReply(''); }, 'Đã gửi trả lời và tắt AI cho hội thoại này.');
  };
  return <>
    <div className="stats-grid">{stats.map((stat) => <button className={`stat-card ${filter === stat.status ? 'stat-selected' : ''}`} key={stat.label} onClick={() => setFilter(stat.status)}><span className={`stat-icon ${stat.color}`}>{stat.icon}</span><span><span className="stat-label">{stat.label}</span><strong>{stat.value}</strong></span><ArrowRightOutlined className="stat-arrow" /></button>)}</div>
    <div className="inbox-toolbar"><Space><Badge status={page.aiEnabled ? 'success' : 'default'} /><strong>{page.name}</strong><Tag>{page.aiEnabled ? 'AI toàn Fanpage đang bật' : 'AI toàn Fanpage đang tắt'}</Tag>{admin && <Tooltip title="Công tắc AI áp dụng cho toàn bộ hội thoại của Fanpage"><Switch aria-label="Bật tắt AI toàn Fanpage" checked={page.aiEnabled} loading={actionBusy} onChange={(enabled) => { void act(() => patch(`/pages/${page.id}`, { aiEnabled: enabled }), enabled ? 'Đã bật AI toàn Fanpage.' : 'Đã tắt AI toàn Fanpage.'); }} /></Tooltip>}</Space>{admin && mode === 'mock' && <Button icon={<ExperimentOutlined />} onClick={() => setSimulatorOpen(true)}>Mô phỏng tin nhắn</Button>}</div>
    {error && <Alert type="error" message={error} showIcon className="form-alert" />}
    <div className="inbox-grid">
      <section className="conversation-list" aria-label="Danh sách hội thoại">
        <div className="conversation-list-head"><div className="list-heading"><strong>Hộp thư</strong><span className="count-pill">{filtered.length}</span></div><Input aria-label="Tìm hội thoại" placeholder="Tìm tên hoặc mã khách hàng" prefix={<SearchOutlined />} value={search} onChange={(event) => setSearch(event.target.value)} allowClear /><Select aria-label="Lọc trạng thái hội thoại" value={filter} onChange={setFilter} options={[{ label: 'Tất cả trạng thái', value: 'ALL' }, ...Object.entries(statusLabels).map(([value, label]) => ({ value, label }))]} /></div>
        <div className="conversation-items">{listBusy && !conversations.length ? <div className="loading-panel"><Spin /></div> : !filtered.length ? <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Không có hội thoại phù hợp" /> : filtered.map((item) => <button className={`conversation-item ${selected === item.id ? 'selected' : ''}`} key={item.id} onClick={() => selectConversation(item.id)}>
          <Avatar size={43} className={`customer-avatar avatar-${item.customerId.length % 4}`}>{(item.customerName || item.customerId).slice(0, 1).toUpperCase()}</Avatar><div className="conversation-preview"><div><strong>{item.customerName || 'Khách hàng'}</strong><time>{new Intl.DateTimeFormat('vi-VN', { hour: '2-digit', minute: '2-digit' }).format(new Date(item.updatedAt))}</time></div><p>{item.messages?.[0]?.text || 'Chưa có tin nhắn'}</p><Tag bordered={false} color={statusColors[item.status]}>{statusLabels[item.status]}</Tag></div>
        </button>)}</div>
        <div className="list-footnote"><CheckCircleOutlined /> Dữ liệu được phân quyền theo Fanpage</div>
      </section>
      <section className="chat-panel" aria-label="Chi tiết hội thoại">
        {detailBusy && !detail ? <div className="loading-panel"><Spin /></div> : detailError ? <Alert type="error" showIcon message={detailError} /> : !detail ? <div className="chat-empty"><CommentOutlined /><Title level={4}>Sẵn sàng lắng nghe</Title><Text type="secondary">Chọn một hội thoại để xem lịch sử và hỗ trợ khách hàng.</Text></div> : <>
          <div className="chat-header"><Space><Avatar size={42} className="customer-avatar">{(detail.customerName || detail.customerId).slice(0, 1).toUpperCase()}</Avatar><div><strong>{detail.customerName || 'Khách hàng'}</strong><div><Badge status={detail.aiEnabled && page.aiEnabled ? 'success' : 'default'} text={detail.aiEnabled && page.aiEnabled ? 'AI đang hỗ trợ' : 'Nhân viên hỗ trợ'} /></div></div></Space><Space><Tag color={statusColors[detail.status]}>{statusLabels[detail.status]}</Tag><Tooltip title={detail.aiEnabled ? 'Tắt AI cho hội thoại' : 'Chủ động bật lại AI cho hội thoại'}><Switch checkedChildren={<RobotOutlined />} unCheckedChildren={<UserOutlined />} aria-label="Bật tắt AI hội thoại" checked={detail.aiEnabled} loading={actionBusy} onChange={(enabled) => { void act(() => patch(`/pages/${page.id}/conversations/${detail.id}/ai`, { enabled }), enabled ? 'Đã bật AI cho hội thoại.' : 'Đã tắt AI cho hội thoại.'); }} /></Tooltip></Space></div>
          {!page.aiEnabled && <div className="chat-info">AI toàn Fanpage đang tắt. Nhân viên có thể trả lời trong cửa sổ nhắn tin.</div>}
          {detail.handoffReason && <div className="chat-handoff"><UserOutlined /><span>{detail.handoffReason}</span></div>}
          <div className="chat-messages" aria-live="polite">{!detail.messages?.length ? <Empty description="Chưa có tin nhắn" image={Empty.PRESENTED_IMAGE_SIMPLE} /> : detail.messages.map((item) => <div key={item.id} className={`message-row ${item.direction === 'OUTBOUND' ? 'outbound' : 'inbound'}`}>
            {item.direction === 'INBOUND' && <Avatar size={27} className="message-avatar"><UserOutlined /></Avatar>}<div className="message-wrap"><div className={`message-bubble ${item.sender === 'AI' ? 'ai-message' : ''}`}>{item.text}</div><div className="message-meta">{item.sender === 'AI' ? <><RobotOutlined /> AI Sales Agent</> : item.sender === 'HUMAN' ? 'Nhân viên' : detail.customerName || 'Khách hàng'}<span>·</span>{dateTime(item.createdAt)}{item.direction === 'OUTBOUND' && <Tag bordered={false} color={item.deliveryStatus === 'FAILED' ? 'error' : item.deliveryStatus === 'SENT' ? 'success' : 'default'}>{item.deliveryStatus === 'SENT' ? 'Đã gửi' : item.deliveryStatus === 'FAILED' ? 'Gửi lỗi' : 'Đang chờ'}</Tag>}</div></div>
          </div>)}<div ref={endRef} /></div>
          <div className="chat-composer">{!canSend && <Alert type="warning" showIcon message="Đã hết hoặc chưa mở cửa sổ nhắn tin 24 giờ. Chờ khách gửi tin mới để trả lời." />}
            <Input.TextArea aria-label="Nội dung trả lời khách hàng" placeholder="Nhập trả lời của bạn…" value={reply} onChange={(event) => setReply(event.target.value)} autoSize={{ minRows: 2, maxRows: 5 }} maxLength={2000} disabled={!canSend} />
            <div className="composer-footer"><span><SafetyHint /> Trả lời thủ công sẽ tắt AI hội thoại.</span><Space>{detail.aiEnabled && <Button icon={<UserOutlined />} loading={actionBusy} onClick={() => { void act(() => post(`/pages/${page.id}/conversations/${detail.id}/takeover`), 'Đã tiếp quản hội thoại.'); }}>Tiếp quản</Button>}<Button type="primary" icon={<SendOutlined />} loading={actionBusy} disabled={!reply.trim() || !canSend} onClick={sendReply}>Gửi trả lời</Button></Space></div>
          </div>
        </>}
      </section>
      <aside className="customer-panel"><div className="customer-panel-title">Thông tin tư vấn</div>{detail ? <>
        <div className="customer-profile"><Avatar size={62} className="customer-avatar">{(detail.customerName || detail.customerId).slice(0, 1).toUpperCase()}</Avatar><strong>{detail.customerName || 'Khách hàng'}</strong><Text type="secondary">Khách hàng Messenger</Text></div>
        <div className="context-section"><span className="field-label">FANPAGE</span><strong>{page.name}</strong><span className="field-label">MÃ KHÁCH HÀNG</span><Text className="customer-id" copyable>{detail.customerId}</Text><span className="field-label">TIN NHẮN KHÁCH GẦN NHẤT</span><span>{dateTime(detail.lastCustomerMessageAt)}</span></div>
        <div className="context-section"><span className="field-label">SẢN PHẨM QUAN TÂM</span>{detail.interestedProduct ? <><strong>{detail.interestedProduct.name}</strong><Text type="secondary">{detail.interestedProduct.sku} · {detail.interestedProduct.dimensions || 'Chưa có kích thước'}</Text></> : <Text type="secondary">Chưa xác định sản phẩm</Text>}</div>
        <div className="quote-card"><div><ShoppingLabel /> Báo giá gần nhất</div><strong>{quote ? money(quote.amount) : 'Chưa báo giá'}</strong>{quote && <small>{dateTime(quote.createdAt)} · Nấc {quote.step}</small>}<p>Giá do backend xác định theo dữ liệu và giới hạn của Fanpage.</p></div>
        <div className="context-note"><CheckCircleOutlined /><span>Khách đồng ý mua sẽ được chuyển shop xác nhận. Hệ thống không tự tạo đơn hàng.</span></div>
      </> : <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="Chọn một khách hàng" />}</aside>
    </div>
    <Simulator open={simulatorOpen} page={page} onClose={() => setSimulatorOpen(false)} onChange={onChange} />
  </>;
}

function SafetyHint() { return <RobotOutlined />; }
function ShoppingLabel() { return <Tag color="orange" bordered={false}>VND</Tag>; }

function Simulator({ open, page, onClose, onChange }: { open: boolean; page: Page; onClose: () => void; onChange: () => void }) {
  const [form] = Form.useForm();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { message } = App.useApp();
  const submit = async () => {
    const values = await form.validateFields(); setBusy(true); setError('');
    try { await post(`/pages/${page.id}/simulate`, values); onChange(); form.setFieldValue('text', ''); void message.success('Đã nhận sự kiện mô phỏng. Hàng đợi sẽ xử lý hội thoại.'); }
    catch (err) { setError(errorMessage(err)); } finally { setBusy(false); }
  };
  return <Modal title="Mô phỏng khách nhắn tin" open={open} onCancel={onClose} onOk={() => { void submit(); }} okText="Gửi sự kiện mô phỏng" confirmLoading={busy}>
    <Alert type="info" showIcon message="Chỉ dùng trong chế độ mock. Không gửi tin nhắn tới Facebook hoặc Telegram thật." className="form-alert" />
    {error && <Alert type="error" showIcon message={error} className="form-alert" />}
    <Form form={form} layout="vertical" initialValues={{ customerId: '', customerName: '' }}><Form.Item label="Mã khách hàng mô phỏng" name="customerId" rules={[{ required: true }, { max: 100 }]}><Input placeholder="Nhập một mã để tạo hoặc tiếp tục hội thoại" /></Form.Item><Form.Item label="Tên hiển thị" name="customerName"><Input placeholder="Tên khách hàng demo" maxLength={100} /></Form.Item><Form.Item label="Nội dung tin nhắn" name="text" rules={[{ required: true }, { max: 2000 }]}><Input.TextArea rows={4} placeholder="Hỏi về tên hoặc SKU sản phẩm trong danh mục của Fanpage…" /></Form.Item></Form>
  </Modal>;
}
