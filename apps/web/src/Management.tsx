import { useEffect, useRef, useState } from 'react';
import { Alert, App, Avatar, Button, Card, Col, Descriptions, Empty, Form, Input, Modal, Popconfirm, Row, Select, Space, Switch, Table, Tag, Typography } from 'antd';
import type { ColumnsType } from 'antd/es/table';
import { CheckCircleOutlined, CloudSyncOutlined, FacebookFilled, LinkOutlined, PlusOutlined, SaveOutlined, TeamOutlined } from '@ant-design/icons';
import { api, dateTime, errorMessage, money, patch, post } from './api';
import type { Audit, Notification, Page, PageSettings, Product, User } from './types';

const { Text, Title, Paragraph } = Typography;

function useRemote<T>(path: string, refresh: number) {
  const [data, setData] = useState<T | null>(null);
  const [busy, setBusy] = useState(true);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true; setBusy(true); setError('');
    api<T>(path).then((result) => { if (active) setData(result); }).catch((err) => { if (active) setError(errorMessage(err)); }).finally(() => { if (active) setBusy(false); });
    return () => { active = false; };
  }, [path, refresh]);
  return { data, busy, error };
}

function LoadError({ error }: { error: string }) { return error ? <Alert type="error" showIcon message={error} className="form-alert" /> : null; }
const segmentLabels: Record<string, string> = { POPULAR: 'Phổ thông', MID: 'Trung cấp', PREMIUM: 'Cao cấp' };

export function ProductsView({ page, refresh, admin, onChange }: { page: Page; refresh: number; admin: boolean; onChange: () => void }) {
  const { data, busy, error } = useRemote<Product[]>(`/pages/${page.id}/products`, refresh);
  const [search, setSearch] = useState('');
  const [syncing, setSyncing] = useState(false);
  const { message } = App.useApp();
  async function sync() { setSyncing(true); try { await post(`/pages/${page.id}/sync`); onChange(); void message.success('Đồng bộ danh mục hoàn tất.'); } catch (err) { void message.error(errorMessage(err)); onChange(); } finally { setSyncing(false); } }
  const columns: ColumnsType<Product> = [
    { title: 'Sản phẩm', key: 'name', width: 260, render: (_, item) => <Space><Avatar shape="square" size={46} src={item.imageUrl || undefined} style={{ background: '#f5e9df', color: '#9b5e3d' }}>{item.name.slice(0, 1)}</Avatar><div><strong>{item.name}</strong><div><Text type="secondary">{item.sku}</Text></div></div></Space> },
    { title: 'Phân khúc', dataIndex: 'segment', render: (value: string) => <Tag>{segmentLabels[value] || value}</Tag> },
    { title: 'Kích thước', dataIndex: 'dimensions', render: (value: string) => value || '—' },
    { title: 'Giá gốc', dataIndex: 'basePrice', render: (value: number | null) => money(value) },
    { title: 'Giá min / max', key: 'bounds', render: (_, item) => <div>{money(item.minPrice)}<div><Text type="secondary">{money(item.maxPrice)}</Text></div></div> },
    { title: 'Tồn kho', dataIndex: 'stock', render: (value: number | null) => value ?? 'Chưa rõ' },
    { title: 'Trạng thái', key: 'status', render: (_, item) => item.dataError ? <Tag color="error">Dữ liệu cần kiểm tra</Tag> : <Tag color={item.active ? 'success' : 'default'}>{item.active ? 'Đang bán' : 'Ngừng bán'}</Tag> },
  ];
  return <><div className="management-summary"><div><CloudSyncOutlined /><span><strong>Google Sheets là nguồn dữ liệu chuẩn</strong><small>Đồng bộ gần nhất: {dateTime(page.lastSyncedAt)}</small></span></div>{admin && <Button type="primary" icon={<CloudSyncOutlined />} loading={syncing} onClick={() => { void sync(); }}>Đồng bộ danh mục</Button>}</div>
    {page.syncError && <Alert type="warning" showIcon message="Đồng bộ gần nhất gặp lỗi — đang hiển thị bản cache trong database." description={page.syncError} className="form-alert" />}
    <Alert type="info" showIcon message="Danh mục chỉ đọc. Giá bán và sàn thương lượng được backend kiểm tra trước mỗi lần báo giá; dữ liệu giá không an toàn sẽ được chuyển nhân viên." className="form-alert" />
    <LoadError error={error} /><Card className="management-card" title="Danh mục sản phẩm" extra={<Input.Search aria-label="Tìm sản phẩm" placeholder="Tìm SKU hoặc tên…" allowClear onChange={(event) => setSearch(event.target.value)} style={{ width: 240 }} />}><Table<Product> rowKey="id" columns={columns} dataSource={(data || []).filter((item) => `${item.name} ${item.sku}`.toLocaleLowerCase('vi').includes(search.toLocaleLowerCase('vi')))} loading={busy} scroll={{ x: 1080 }} pagination={{ pageSize: 10, showSizeChanger: false }} locale={{ emptyText: 'Chưa có sản phẩm. Kiểm tra mapping và đồng bộ từ Google Sheets.' }} expandable={{ expandedRowRender: (item) => <Descriptions size="small" column={1}><Descriptions.Item label="Mô tả">{item.description || 'Chưa có mô tả'}</Descriptions.Item>{item.dataError && <Descriptions.Item label="Lỗi dữ liệu"><Text type="danger">{item.dataError}</Text></Descriptions.Item>}</Descriptions> }} /></Card>
  </>;
}

export function NotificationsView({ page, refresh }: { page: Page; refresh: number }) {
  const { data, busy, error } = useRemote<Notification[]>(`/pages/${page.id}/notifications`, refresh);
  const columns: ColumnsType<Notification> = [
    { title: 'Thời điểm', dataIndex: 'createdAt', render: (value: string) => dateTime(value), width: 170 },
    { title: 'Lý do chuyển tiếp', dataIndex: 'reason' },
    { title: 'Telegram', dataIndex: 'status', render: (value: string) => <Tag color={value === 'SENT' ? 'success' : value === 'FAILED' ? 'error' : 'processing'}>{value === 'SENT' ? 'Đã gửi' : value === 'FAILED' ? 'Gặp lỗi' : 'Đang chờ'}</Tag> },
    { title: 'Số lần thử', dataIndex: 'attempts', width: 110 },
    { title: 'Hội thoại', key: 'conversation', render: (_, item) => item.conversationId ? <a href={`/?pageId=${encodeURIComponent(page.id)}&conversationId=${encodeURIComponent(item.conversationId)}`}><LinkOutlined /> Mở hội thoại</a> : '—' },
  ];
  return <><Alert type="info" showIcon message="Hội thoại cần nhân viên luôn nằm trong hộp thư, kể cả khi Telegram chưa gửi được. Thông báo Telegram không chứa dữ liệu cá nhân nhạy cảm." className="form-alert" /><LoadError error={error} /><Card className="management-card" title="Lịch sử thông báo chuyển nhân viên"><Table<Notification> rowKey="id" loading={busy} dataSource={data || []} columns={columns} scroll={{ x: 800 }} pagination={{ pageSize: 10 }} expandable={{ expandedRowRender: (item) => item.error ? <Text type="danger">{item.error}</Text> : <Text type="secondary">Không có lỗi gửi thông báo.</Text> }} locale={{ emptyText: 'Chưa có thông báo chuyển nhân viên.' }} /></Card></>;
}

export function PageSettingsView({ pages, selectedId, onChange }: { pages: Page[]; selectedId: string; onChange: () => void }) {
  const [editingId, setEditingId] = useState(selectedId);
  const [creating, setCreating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [form] = Form.useForm();
  const { message } = App.useApp();
  useEffect(() => { setEditingId(selectedId); }, [selectedId]);
  const page = pages.find((item) => item.id === editingId) || pages[0];
  async function create() {
    const values = await form.validateFields(); setSaving(true); setError('');
    try { const created = await post<Page>('/pages', values); setEditingId(created.id); setCreating(false); form.resetFields(); onChange(); void message.success('Đã tạo Fanpage. Hãy cấu hình kết nối trước khi dùng tích hợp thật.'); }
    catch (err) { setError(errorMessage(err)); } finally { setSaving(false); }
  }
  return <><div className="section-toolbar"><div><Title level={4}>Fanpage của tổ chức</Title><Text type="secondary">Chỉ Super Admin có thể thay đổi kết nối, AI và cấu hình giá.</Text></div><Button type="primary" icon={<PlusOutlined />} onClick={() => setCreating(true)}>Thêm Fanpage</Button></div>
    <div className="page-cards">{pages.map((item) => <button key={item.id} className={`page-select-card ${page?.id === item.id ? 'active' : ''}`} onClick={() => setEditingId(item.id)}><span className="facebook-icon"><FacebookFilled /></span><div><strong>{item.name}</strong><small>ID: {item.externalPageId}</small></div><Tag color={item.aiEnabled ? 'success' : 'default'}>{item.aiEnabled ? 'AI bật' : 'AI tắt'}</Tag></button>)}</div>
    {page ? <PageConfiguration key={page.id} page={page} onChange={onChange} /> : <Card><Empty description="Thêm Fanpage đầu tiên để thiết lập kết nối." /></Card>}
    <Modal title="Thêm Fanpage" open={creating} onCancel={() => setCreating(false)} onOk={() => { void create(); }} confirmLoading={saving} okText="Tạo Fanpage"><LoadError error={error} /><Form form={form} layout="vertical"><Form.Item name="name" label="Tên Fanpage" rules={[{ required: true }, { max: 100 }]}><Input placeholder="Tên thương hiệu" /></Form.Item><Form.Item name="externalPageId" label="Facebook Page ID" rules={[{ required: true }, { max: 100 }]}><Input placeholder="Page ID từ Meta (mã riêng trong chế độ mock)" /></Form.Item></Form></Modal>
  </>;
}

const mappingFields: Array<[string, string]> = [['sku', 'SKU'], ['name', 'Tên sản phẩm'], ['segment', 'Phân khúc'], ['description', 'Mô tả'], ['dimensions', 'Kích thước'], ['imageUrl', 'Link ảnh'], ['stock', 'Tồn kho'], ['active', 'Trạng thái bán'], ['basePrice', 'Giá gốc'], ['minPrice', 'Giá min'], ['maxPrice', 'Giá max']];
interface ConfigValues { name: string; externalPageId: string; aiEnabled: boolean; spreadsheetId?: string; tab?: string; telegramChatId?: string; mapping?: Record<string, string>; popularRules: string; midRules: string; premiumRules: string; messengerToken?: string; googleCredentials?: string; telegramToken?: string }
function configValues(page: Page): ConfigValues {
  const settings = page.settings || {};
  const rules = settings.segmentRules || {};
  return { name: page.name, externalPageId: page.externalPageId, aiEnabled: page.aiEnabled, spreadsheetId: settings.sheet?.spreadsheetId, tab: settings.sheet?.tab, mapping: settings.sheet?.mapping || {}, telegramChatId: settings.telegramChatId, popularRules: (rules.POPULAR || []).join(', '), midRules: (rules.MID || []).join(', '), premiumRules: (rules.PREMIUM || []).join(', '), messengerToken: '', googleCredentials: '', telegramToken: '' };
}
function PageConfiguration({ page, onChange }: { page: Page; onChange: () => void }) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const { message, modal } = App.useApp();
  const [form] = Form.useForm<ConfigValues>();
  const dirty = useRef(false);
  const saving = useRef(false);
  const baseline = useRef(page);
  const settings = page.settings || {};
  useEffect(() => {
    // Realtime invalidations may refresh the Page object while an admin is typing.
    if (!dirty.current) { baseline.current = page; form.setFieldsValue(configValues(page)); }
  }, [page, form]);
  function parseSteps(value: string) {
    const values = value.trim() ? value.split(',').map((part) => Number(part.trim())) : [];
    if (values.some((item) => !Number.isFinite(item) || item < 0 || item > 1) || values.length > 10) throw new Error('Mỗi nấc giảm cần là số từ 0 đến 1; tối đa 10 nấc.');
    return values;
  }
  async function save(values: ConfigValues) {
    if (saving.current) return;
    saving.current = true; setBusy(true); setError('');
    try {
      const externalPageId = values.externalPageId.trim();
      const bindingChanged = externalPageId !== baseline.current.externalPageId;
      if (bindingChanged) {
        const confirmed = await new Promise<boolean>((resolve) => {
          modal.confirm({
            title: 'Đổi Facebook Page ID?',
            content: <><Paragraph>Đổi từ <Text code>{baseline.current.externalPageId}</Text> sang <Text code>{externalPageId}</Text>.</Paragraph><Paragraph>AI của Fanpage sẽ tạm tắt. Hãy kiểm tra token và kết nối Messenger của Page mới trước khi bật lại AI. Token cũ sẽ được xóa nếu bạn chưa nhập token mới.</Paragraph><Text type="secondary">Fanpage đã có lịch sử hội thoại cần tạo kết nối mới để giữ đúng dữ liệu khách hàng.</Text></>,
            okText: 'Đổi Page ID và lưu', cancelText: 'Giữ cấu hình',
            onOk: () => resolve(true), onCancel: () => resolve(false),
          });
        });
        if (!confirmed) return;
      }
      const nextSettings: PageSettings = { ...settings, telegramChatId: values.telegramChatId?.trim() || '', sheet: { spreadsheetId: values.spreadsheetId?.trim() || '', tab: values.tab?.trim() || '', mapping: Object.fromEntries(Object.entries(values.mapping || {}).filter(([, value]) => value?.trim()).map(([key, value]) => [key, value.trim()])) }, segmentRules: { POPULAR: parseSteps(values.popularRules), MID: parseSteps(values.midRules), PREMIUM: parseSteps(values.premiumRules) } };
      let googleCredentials: string | undefined;
      if (values.googleCredentials?.trim()) { JSON.parse(values.googleCredentials); googleCredentials = values.googleCredentials.trim(); }
      const saved = await patch<Page>(`/pages/${page.id}`, { name: values.name.trim(), ...(bindingChanged ? { externalPageId } : {}), aiEnabled: values.aiEnabled, settings: nextSettings, ...(values.messengerToken?.trim() ? { messengerToken: values.messengerToken.trim() } : {}), ...(googleCredentials ? { googleCredentials } : {}), ...(values.telegramToken?.trim() ? { telegramToken: values.telegramToken.trim() } : {}) });
      baseline.current = saved; dirty.current = false;
      form.setFieldsValue(configValues(saved)); onChange();
      void message.success(bindingChanged ? 'Đã đổi Page ID. AI đang tạm tắt để bạn kiểm tra lại kết nối Messenger.' : 'Đã lưu cấu hình Fanpage.');
    } catch (err) { setError(errorMessage(err)); } finally { saving.current = false; setBusy(false); }
  }
  const configured = (name: 'messenger' | 'google' | 'telegram') => page.integrations?.[name] || (name === 'messenger' ? page.hasMessengerToken : name === 'google' ? page.hasGoogleCredentials : page.hasTelegramToken);
  return <Form<ConfigValues> form={form} layout="vertical" disabled={busy} onValuesChange={() => { dirty.current = true; }} onFinish={(values) => { void save(values); }} initialValues={configValues(page)}>
    <LoadError error={error} />
    <Card className="management-card" title="Thông tin & quyền vận hành" extra={<Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={busy}>Lưu thông tin Fanpage</Button>}><Row gutter={24}><Col xs={24} md={12}><Form.Item name="name" label="Tên hiển thị" rules={[{ required: true, whitespace: true }, { max: 100 }]}><Input /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="externalPageId" label="Facebook Page ID" rules={[{ required: true, whitespace: true, message: 'Nhập Facebook Page ID.' }, { max: 100, message: 'Page ID tối đa 100 ký tự.' }]} extra="Dùng Page ID của Fanpage bạn quản lý. Đổi Page ID sẽ tạm tắt AI để kiểm tra lại kết nối."><Input autoComplete="off" inputMode="numeric" maxLength={100} /></Form.Item></Col></Row><Form.Item name="aiEnabled" label="AI tư vấn toàn Fanpage" valuePropName="checked"><Switch checkedChildren="Bật" unCheckedChildren="Tắt" /></Form.Item><Text type="secondary">Khi tắt, AI không được phản hồi bất kỳ hội thoại nào thuộc Fanpage này.</Text></Card>
    <Card className="management-card" title={<Space>Messenger <Tag color={configured('messenger') ? 'success' : 'default'}>{configured('messenger') ? 'Đã cấu hình token' : 'Chưa cấu hình token'}</Tag></Space>}><Form.Item name="messengerToken" label="Page Access Token mới"><Input.Password autoComplete="new-password" placeholder="Để trống để giữ token đã lưu" /></Form.Item><Paragraph type="secondary">Webhook công khai: <Text code>/api/webhooks/messenger</Text>. App Secret và Verify Token cấu hình trong .env của backend. Cần hoàn tất quyền Meta và kiểm tra webhook trước khi dùng thật.</Paragraph></Card>
    <Card className="management-card" title={<Space>Google Sheets <Tag color={configured('google') ? 'success' : 'default'}>{configured('google') ? 'Đã cấu hình credential' : 'Chưa cấu hình credential'}</Tag></Space>}>
      <Row gutter={24}><Col xs={24} md={15}><Form.Item name="spreadsheetId" label="Spreadsheet ID"><Input placeholder="ID trong URL Google Sheets" /></Form.Item></Col><Col xs={24} md={9}><Form.Item name="tab" label="Tên sheet / tab"><Input placeholder="Tên tab chính xác" /></Form.Item></Col></Row>
      <Alert type="warning" showIcon message="Mapping phải được xác nhận theo bảng chính thức. Không tự gán cột Giá 1 / Giá 2 / Giá 3 thành giá bán lẻ." className="form-alert" />
      <Row gutter={20}>{mappingFields.map(([key, label]) => <Col xs={24} sm={12} lg={8} key={key}><Form.Item name={['mapping', key]} label={`Cột ${label}`}><Input placeholder={`Tên tiêu đề cột ${label.toLowerCase()}`} /></Form.Item></Col>)}</Row>
      <Form.Item name="googleCredentials" label="Service account JSON mới"><Input.TextArea rows={3} autoComplete="off" placeholder="Để trống để giữ credential đã lưu. Không được trả lại credential từ API." /></Form.Item><Text type="secondary">Chia sẻ bảng cho email của service account với quyền xem. Dữ liệu trong dashboard là cache chỉ đọc.</Text>
    </Card>
    <Card className="management-card" title="Chiến lược thương lượng theo phân khúc"><Paragraph type="secondary">Mỗi số là tỷ lệ giảm so với giá chào ban đầu, phân cách bằng dấu phẩy; ví dụ 0.03, 0.02. Để trống nghĩa là không có nấc giảm. Chỉ giảm khi khách mặc cả và luôn bị chặn ở sàn an toàn.</Paragraph><Row gutter={24}><Col xs={24} md={8}><Form.Item name="popularRules" label="Phổ thông" rules={[{ validator: (_, value: string) => { try { parseSteps(value || ''); return Promise.resolve(); } catch (err) { return Promise.reject(err); } } }]}><Input placeholder="Các nấc giảm đã phê duyệt" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="midRules" label="Trung cấp"><Input placeholder="Các nấc giảm đã phê duyệt" /></Form.Item></Col><Col xs={24} md={8}><Form.Item name="premiumRules" label="Cao cấp"><Input placeholder="Các nấc giảm đã phê duyệt" /></Form.Item></Col></Row><Alert type="info" showIcon message="Quy tắc giá nền: chào = giá gốc × 1,7 và sàn = giá gốc × 1,5; nếu có min/max, backend áp dụng giới hạn hiệu lực và chặn dữ liệu mâu thuẫn." /></Card>
    <Card className="management-card" title={<Space>Telegram <Tag color={configured('telegram') ? 'success' : 'default'}>{configured('telegram') ? 'Đã cấu hình bot' : 'Chưa cấu hình bot'}</Tag></Space>}><Row gutter={24}><Col xs={24} md={12}><Form.Item name="telegramChatId" label="Chat ID / Group ID của Fanpage"><Input placeholder="Chat ID đích" /></Form.Item></Col><Col xs={24} md={12}><Form.Item name="telegramToken" label="Bot token mới"><Input.Password autoComplete="new-password" placeholder="Để trống để giữ token đã lưu" /></Form.Item></Col></Row><Text type="secondary">Thông báo chỉ gồm Fanpage, lý do, sản phẩm, giá gần nhất và liên kết hội thoại.</Text></Card>
    <div className="settings-save"><Text type="secondary"><CheckCircleOutlined /> Token đã lưu không bao giờ hiển thị trở lại.</Text><Button type="primary" htmlType="submit" icon={<SaveOutlined />} loading={busy}>Lưu cấu hình Fanpage</Button></div>
  </Form>;
}

export function UsersView({ pages, refresh, onChange }: { pages: Page[]; refresh: number; onChange: () => void }) {
  const { data, busy, error } = useRemote<User[]>('/users', refresh);
  const [selectedUser, setSelectedUser] = useState<User | null>(null);
  const [selectedPageId, setSelectedPageId] = useState('');
  const [actionBusy, setActionBusy] = useState(false);
  const { message } = App.useApp();
  async function grant(user: User, pageId: string, remove: boolean) {
    setActionBusy(true);
    try { await api(`/pages/${pageId}/members/${user.id}`, { method: remove ? 'DELETE' : 'PUT' }); onChange(); setSelectedUser(null); void message.success(remove ? 'Đã thu hồi quyền Fanpage.' : 'Đã cấp quyền Fanpage.'); }
    catch (err) { void message.error(errorMessage(err)); } finally { setActionBusy(false); }
  }
  const columns: ColumnsType<User> = [
    { title: 'Nhân viên', key: 'user', render: (_, item) => <Space><Avatar style={{ background: '#e8edf2', color: '#496074' }}>{item.name.slice(0, 1)}</Avatar><div><strong>{item.name}</strong><div><Text type="secondary">{item.email}</Text></div></div></Space> },
    { title: 'Vai trò', dataIndex: 'role', render: (value: string) => <Tag color={value === 'SUPER_ADMIN' ? 'purple' : 'default'}>{value === 'SUPER_ADMIN' ? 'Super Admin' : 'Nhân viên'}</Tag> },
    { title: 'Email', dataIndex: 'emailVerifiedAt', render: (value: string | null) => <Tag color={value ? 'success' : 'warning'}>{value ? 'Đã xác thực' : 'Chưa xác thực'}</Tag> },
    { title: 'Fanpage được phân công', key: 'pages', render: (_, item) => item.role === 'SUPER_ADMIN' ? <Text type="secondary">Tất cả Fanpage</Text> : item.memberships?.length ? <Space wrap>{item.memberships.map((member) => <Popconfirm key={member.pageId} title="Thu hồi quyền Fanpage này?" description="Nhân viên sẽ không còn xem hoặc trả lời hội thoại tại Fanpage." onConfirm={() => grant(item, member.pageId, true)} okText="Thu hồi" cancelText="Giữ quyền"><Tag className="grant-tag" color="blue">{member.page?.name || pages.find((entry) => entry.id === member.pageId)?.name || member.pageId} ×</Tag></Popconfirm>)}</Space> : <Text type="secondary">Chưa được cấp quyền</Text> },
    { title: '', key: 'actions', width: 130, render: (_, item) => item.role !== 'SUPER_ADMIN' && <Button size="small" icon={<PlusOutlined />} disabled={!item.emailVerifiedAt} onClick={() => { setSelectedUser(item); setSelectedPageId(''); }}>Cấp quyền</Button> },
  ];
  return <><Alert type="info" showIcon message="Tài khoản tự đăng ký không có quyền Fanpage mặc định. Chỉ Super Admin cấp hoặc thu hồi quyền; thay đổi được ghi audit log." className="form-alert" /><LoadError error={error} /><Card className="management-card" title={<Space><TeamOutlined /> Danh sách người dùng</Space>}><Table<User> rowKey="id" dataSource={data || []} columns={columns} loading={busy || actionBusy} scroll={{ x: 900 }} pagination={{ pageSize: 10 }} /></Card><Modal title={`Cấp quyền cho ${selectedUser?.name || ''}`} open={!!selectedUser} onCancel={() => setSelectedUser(null)} onOk={() => { if (selectedUser && selectedPageId) void grant(selectedUser, selectedPageId, false); }} okButtonProps={{ disabled: !selectedPageId }} confirmLoading={actionBusy} okText="Cấp quyền Fanpage"><Paragraph>Nhân viên được xem, trả lời và tiếp quản hội thoại của Fanpage; không được đổi giá hoặc cấu hình AI.</Paragraph><Select aria-label="Fanpage cấp quyền" value={selectedPageId || undefined} onChange={setSelectedPageId} placeholder="Chọn Fanpage" style={{ width: '100%' }} options={pages.filter((page) => !selectedUser?.memberships?.some((member) => member.pageId === page.id)).map((page) => ({ label: page.name, value: page.id }))} /></Modal></>;
}

export function AuditView({ pageId, refresh }: { pageId: string; refresh: number }) {
  const { data, busy, error } = useRemote<Audit[]>(`/audit${pageId ? `?pageId=${encodeURIComponent(pageId)}` : ''}`, refresh);
  const columns: ColumnsType<Audit> = [
    { title: 'Thời điểm', dataIndex: 'createdAt', render: (value: string) => dateTime(value), width: 180 },
    { title: 'Hành động', dataIndex: 'action', render: (value: string) => <Tag>{value}</Tag> },
    { title: 'Người thực hiện', dataIndex: 'actorId', render: (value: string | null) => value || 'Hệ thống' },
    { title: 'Fanpage', dataIndex: 'pageId', render: (value: string | null) => value || 'Toàn hệ thống' },
  ];
  return <><LoadError error={error} /><Card className="management-card" title="Nhật ký quyền truy cập & vận hành"><Table<Audit> rowKey="id" loading={busy} columns={columns} dataSource={data || []} scroll={{ x: 850 }} pagination={{ pageSize: 15 }} expandable={{ expandedRowRender: (item) => <pre className="audit-json">{JSON.stringify(item.metadata, null, 2)}</pre> }} locale={{ emptyText: 'Chưa có hoạt động được ghi nhận.' }} /></Card></>;
}
