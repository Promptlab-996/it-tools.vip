(function () {
'use strict';

const $ = (s, el) => (el || document).querySelector(s);
const $$ = (s, el) => Array.prototype.slice.call((el || document).querySelectorAll(s));

const escapeHtml = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

const store = {
  get(k, d) { try { const v = JSON.parse(localStorage.getItem('itops:' + k)); return v == null ? d : v; } catch (e) { return d; } },
  set(k, v) { try { localStorage.setItem('itops:' + k, JSON.stringify(v)); } catch (e) {} }
};

let cleanups = [];
function cleanup(fn) { cleanups.push(fn); }

function copyText(text, btn) {
  const done = () => {
    if (!btn) return;
    const o = btn.textContent;
    btn.textContent = '已复制 ✓';
    setTimeout(() => { btn.textContent = o; }, 1200);
  };
  const fallback = () => {
    const ta = document.createElement('textarea');
    ta.value = text;
    ta.style.position = 'fixed';
    ta.style.opacity = '0';
    document.body.appendChild(ta);
    ta.select();
    try { document.execCommand('copy'); done(); } catch (e) {}
    ta.remove();
  };
  if (navigator.clipboard && navigator.clipboard.writeText) {
    navigator.clipboard.writeText(text).then(done).catch(fallback);
  } else fallback();
}

function ipToLong(ip) {
  const m = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(ip);
  if (!m) return null;
  const o = [+m[1], +m[2], +m[3], +m[4]];
  if (o.some(x => x > 255)) return null;
  return ((o[0] * 256 + o[1]) * 256 + o[2]) * 256 + o[3];
}

function longToIp(n) {
  return [Math.floor(n / 16777216) % 256, Math.floor(n / 65536) % 256, Math.floor(n / 256) % 256, n % 256].join('.');
}

function calcCIDR(input) {
  if (!input) return '<div class="empty">请输入 IP 地址或 CIDR</div>';
  let ipPart, prefix;
  const slash = input.indexOf('/');
  if (slash >= 0) {
    ipPart = input.slice(0, slash).trim();
    const maskPart = input.slice(slash + 1).trim();
    if (/^\d{1,2}$/.test(maskPart)) {
      prefix = +maskPart;
    } else {
      const m = ipToLong(maskPart);
      if (m === null) return '<div class="empty">子网掩码格式不正确</div>';
      const bin = (m >>> 0).toString(2).padStart(32, '0');
      if (!/^1*0*$/.test(bin)) return '<div class="empty">子网掩码不连续，无法计算</div>';
      prefix = bin.indexOf('0') === -1 ? 32 : bin.indexOf('0');
    }
  } else {
    ipPart = input.trim();
    prefix = 24;
  }
  if (prefix < 0 || prefix > 32) return '<div class="empty">前缀长度需在 0-32 之间</div>';
  const ip = ipToLong(ipPart);
  if (ip === null) return '<div class="empty">IP 地址格式不正确</div>';

  const mask = prefix === 0 ? 0 : (~((1 << (32 - prefix)) - 1)) >>> 0;
  const wildcard = (~mask) >>> 0;
  const net = (ip & mask) >>> 0;
  const bcast = (net | wildcard) >>> 0;
  const total = Math.pow(2, 32 - prefix);
  const usable = prefix <= 30 ? total - 2 : prefix === 31 ? 2 : 1;
  const first = prefix <= 30 ? longToIp((net + 1) >>> 0) : longToIp(net);
  const last = prefix <= 30 ? longToIp((bcast - 1) >>> 0) : longToIp(bcast);

  const o1 = Math.floor(ip / 16777216);
  let cls;
  if (o1 === 127) cls = '环回地址';
  else if (o1 >= 1 && o1 <= 126) cls = 'A 类';
  else if (o1 >= 128 && o1 <= 191) cls = 'B 类';
  else if (o1 >= 192 && o1 <= 223) cls = 'C 类';
  else if (o1 >= 224 && o1 <= 239) cls = 'D 类（组播）';
  else cls = 'E 类（保留）';

  const o2 = Math.floor(ip / 65536) % 256;
  const priv = o1 === 10 || (o1 === 172 && o2 >= 16 && o2 <= 31) || (o1 === 192 && o2 === 168) || o1 === 127 || (o1 === 169 && o2 === 254);

  const row = (k, v) => `<tr><td>${k}</td><td>${v}</td></tr>`;
  return `
  <div class="card">
    <table class="tbl">
      <tbody>
        ${row('输入', escapeHtml(input))}
        ${row('网络地址', `<code>${longToIp(net)}</code>`)}
        ${row('广播地址', `<code>${longToIp(bcast)}</code>`)}
        ${row('子网掩码', `<code>${longToIp(mask)}</code>`)}
        ${row('反掩码（通配符）', `<code>${longToIp(wildcard)}</code>`)}
        ${row('CIDR 表示', `<code>${longToIp(net)}/${prefix}</code>`)}
        ${row('IP 总数', total.toLocaleString())}
        ${row('可用 IP 数', usable.toLocaleString())}
        ${row('可用 IP 范围', `<code>${first}</code> ～ <code>${last}</code>`)}
        ${row('地址类别', cls)}
        ${row('公网 / 私网', priv ? '🔒 私网 / 保留地址' : '🌐 公网地址')}
      </tbody>
    </table>
  </div>`;
}

function cmdGen(container, groups, hint) {
  const flat = [];
  container.innerHTML = `
  <div class="card">
    ${hint ? `<div class="hint">${hint}</div>` : ''}
    <label>选择操作</label>
    <select id="cgSel"></select>
    <div id="cgParams" class="params"></div>
  </div>
  <div id="cgOut"></div>`;
  const sel = $('#cgSel', container);
  sel.innerHTML = groups.map(g =>
    `<optgroup label="${escapeHtml(g.group)}">` +
    g.items.map(it => { flat.push(it); return `<option value="${flat.length - 1}">${escapeHtml(it.name)}</option>`; }).join('') +
    `</optgroup>`
  ).join('');
  const out = $('#cgOut', container);
  const paramsBox = $('#cgParams', container);

  function collect() {
    const item = flat[+sel.value];
    const vals = {};
    (item.params || []).forEach(p => { vals[p.key] = ($('#p_' + p.key, paramsBox) ? $('#p_' + p.key, paramsBox).value : '').trim(); });
    return vals;
  }

  function update(item, vals) {
    let cmds;
    try { cmds = item.cmds(vals); } catch (e) { cmds = []; }
    if (!cmds || !cmds.length) { out.innerHTML = '<div class="empty">请填写参数</div>'; return; }
    out.innerHTML = cmds.map((c, i) => `
      <div class="cmd">
        <div class="cmd-head"><span>${escapeHtml(c.label || item.name)}</span><button class="btn small" data-i="${i}">复制</button></div>
        <pre><code>${escapeHtml(c.cmd)}</code></pre>
      </div>`).join('');
    $$('button', out).forEach(b => { b.onclick = () => copyText(cmds[+b.dataset.i].cmd, b); });
  }

  function showParams() {
    const item = flat[+sel.value];
    if (!item.params || !item.params.length) {
      paramsBox.innerHTML = '';
      update(item, {});
      return;
    }
    paramsBox.innerHTML = item.params.map(p => `
      <div class="param">
        <label>${escapeHtml(p.label)}</label>
        <input id="p_${p.key}" placeholder="${escapeHtml(p.placeholder || '')}" value="${escapeHtml(p.def != null ? p.def : '')}">
      </div>`).join('');
    $$('input', paramsBox).forEach(inp => { inp.addEventListener('input', () => update(item, collect())); });
    update(item, collect());
  }

  sel.onchange = showParams;
  showParams();
}

const WIN_GROUPS = [
  {
    group: '查看',
    items: [
      {
        name: '端口占用情况',
        params: [{ key: 'port', label: '端口号（留空查看全部监听）', placeholder: '443' }],
        cmds: v => v.port ? [
          { cmd: `Get-NetTCPConnection -LocalPort ${v.port}` },
          { cmd: `netstat -ano | findstr ":${v.port}"` }
        ] : [
          { cmd: 'Get-NetTCPConnection -State Listen | Sort-Object LocalPort' },
          { cmd: 'netstat -ano' }
        ]
      },
      {
        name: '服务状态',
        params: [{ key: 'svc', label: '服务名（留空列出全部）', placeholder: 'WinRM' }],
        cmds: v => v.svc ? [
          { cmd: `Get-Service -Name ${v.svc}` },
          { cmd: `sc query ${v.svc}` }
        ] : [
          { cmd: 'Get-Service | Sort-Object Status, Name' },
          { cmd: 'sc query state= all' }
        ]
      },
      {
        name: '进程详情',
        params: [{ key: 'name', label: '进程名（留空看 Top10）', placeholder: 'chrome' }],
        cmds: v => v.name ? [
          { cmd: `Get-Process -Name ${v.name} | Format-List *` },
          { cmd: `tasklist | findstr "${v.name}"` }
        ] : [
          { cmd: 'Get-Process | Sort-Object CPU -Descending | Select-Object -First 10' },
          { cmd: 'tasklist' }
        ]
      },
      {
        name: '磁盘空间',
        cmds: () => [
          { cmd: 'Get-PSDrive -PSProvider FileSystem' },
          { cmd: 'Get-CimInstance Win32_LogicalDisk | Select-Object DeviceID, Size, FreeSpace' }
        ]
      },
      {
        name: '网络配置',
        cmds: () => [
          { cmd: 'Get-NetIPConfiguration' },
          { cmd: 'Get-NetAdapter | Select-Object Name, Status, MacAddress, LinkSpeed' },
          { cmd: 'ipconfig /all' }
        ]
      },
      {
        name: '本地用户',
        cmds: () => [
          { cmd: 'Get-LocalUser' },
          { cmd: 'net user' }
        ]
      }
    ]
  },
  {
    group: '管理',
    items: [
      {
        name: '启动 / 停止 / 重启服务',
        params: [{ key: 'svc', label: '服务名', placeholder: 'Spooler' }],
        cmds: v => [
          { cmd: `Start-Service -Name ${v.svc}` },
          { cmd: `Stop-Service -Name ${v.svc} -Force` },
          { cmd: `Restart-Service -Name ${v.svc} -Force` }
        ]
      },
      {
        name: '结束进程',
        params: [{ key: 'name', label: '进程名', placeholder: 'notepad' }],
        cmds: v => [
          { cmd: `Stop-Process -Name ${v.name} -Force` },
          { cmd: `taskkill /F /IM ${v.name}.exe` }
        ]
      },
      {
        name: '防火墙规则',
        cmds: () => [
          { cmd: 'Get-NetFirewallRule -Enabled True | Select-Object DisplayName, Direction, Action' },
          { cmd: 'netsh advfirewall firewall show rule name=all' }
        ]
      },
      {
        name: '远程会话',
        params: [{ key: 'host', label: '主机名 / IP', placeholder: '192.168.1.10' }],
        cmds: v => [
          { cmd: `Enter-PSSession -ComputerName ${v.host}` },
          { cmd: `mstsc /v:${v.host}` }
        ]
      },
      {
        name: '系统日志',
        cmds: () => [
          { cmd: 'Get-WinEvent -LogName System -MaxEvents 20' },
          { cmd: 'Get-EventLog -LogName System -Newest 20' }
        ]
      },
      {
        name: '计划任务',
        cmds: () => [
          { cmd: "Get-ScheduledTask | Where-Object { `$_.State -ne 'Disabled' } | Select-Object TaskName, State" }
        ]
      }
    ]
  }
];

const LINUX_GROUPS = [
  {
    group: '查看',
    items: [
      {
        name: 'CPU 信息',
        cmds: () => [
          { cmd: 'lscpu' },
          { cmd: 'top -bn1 | head -15' },
          { cmd: 'uptime' }
        ]
      },
      {
        name: '内存使用',
        cmds: () => [
          { cmd: 'free -h' },
          { cmd: 'cat /proc/meminfo | head -5' }
        ]
      },
      {
        name: '磁盘使用',
        cmds: () => [
          { cmd: 'df -h' },
          { cmd: 'lsblk' },
          { cmd: 'du -sh /* 2>/dev/null | sort -h | tail -20' }
        ]
      },
      {
        name: '端口监听',
        params: [{ key: 'port', label: '端口号（留空查看全部）', placeholder: '443' }],
        cmds: v => v.port ? [
          { cmd: `ss -lntp | grep ":${v.port}"` },
          { cmd: `netstat -lntp | grep ":${v.port}"` }
        ] : [
          { cmd: 'ss -lntp' },
          { cmd: 'netstat -lntp' }
        ]
      },
      {
        name: '进程查看',
        cmds: () => [
          { cmd: 'ps aux --sort=-%cpu | head -10' },
          { cmd: 'top -bn1 | head -15' }
        ]
      },
      {
        name: '服务状态',
        params: [{ key: 'svc', label: '服务名（留空看运行中）', placeholder: 'nginx' }],
        cmds: v => v.svc ? [
          { cmd: `systemctl status ${v.svc} --no-pager` },
          { cmd: `service ${v.svc} status` }
        ] : [
          { cmd: 'systemctl list-units --type=service --state=running' }
        ]
      },
      {
        name: '服务日志（journalctl）',
        params: [{ key: 'svc', label: '服务名', placeholder: 'sshd' }],
        cmds: v => [
          { cmd: `journalctl -u ${v.svc} -n 100 --no-pager` },
          { cmd: `journalctl -u ${v.svc} -f` }
        ]
      },
      {
        name: '文件日志',
        params: [{ key: 'file', label: '日志文件路径', placeholder: '/var/log/messages' }],
        cmds: v => [
          { cmd: `tail -n 100 ${v.file}` },
          { cmd: `tail -f ${v.file}` }
        ]
      },
      {
        name: '登录用户',
        cmds: () => [
          { cmd: 'w' },
          { cmd: 'last -10' },
          { cmd: 'who' }
        ]
      },
      {
        name: '系统信息',
        cmds: () => [
          { cmd: 'uname -a' },
          { cmd: 'cat /etc/os-release' },
          { cmd: 'hostnamectl' }
        ]
      }
    ]
  },
  {
    group: '管理',
    items: [
      {
        name: '重启 / 启用服务',
        params: [{ key: 'svc', label: '服务名', placeholder: 'nginx' }],
        cmds: v => [
          { cmd: `systemctl restart ${v.svc}` },
          { cmd: `systemctl enable --now ${v.svc}` }
        ]
      },
      {
        name: '结束进程',
        params: [{ key: 'pid', label: 'PID', placeholder: '1234' }],
        cmds: v => [
          { cmd: `kill -9 ${v.pid}` },
          { cmd: `kill -15 ${v.pid}` }
        ]
      },
      {
        name: '定时任务',
        cmds: () => [
          { cmd: 'crontab -l' },
          { cmd: 'sudo crontab -l' }
        ]
      },
      {
        name: '挂载信息',
        cmds: () => [
          { cmd: 'mount | column -t' },
          { cmd: 'findmnt' }
        ]
      },
      {
        name: '软件包查询',
        params: [{ key: 'pkg', label: '包名（留空跳过）', placeholder: 'nginx' }],
        cmds: v => v.pkg ? [
          { cmd: `rpm -qa | grep ${v.pkg}` },
          { cmd: `dpkg -l | grep ${v.pkg}` }
        ] : [
          { cmd: 'rpm -qa | wc -l' },
          { cmd: 'dpkg -l | wc -l' }
        ]
      }
    ]
  }
];

const VMWARE_GROUPS = [
  {
    group: '存储',
    items: [
      { name: '存储设备列表', cmds: () => [{ cmd: 'esxcli storage core device list' }] },
      { name: '文件系统列表', cmds: () => [{ cmd: 'esxcli storage filesystem list' }] },
      { name: 'VMFS 数据存储', cmds: () => [{ cmd: 'esxcli storage vmfs extent list' }] },
      { name: 'HBA 适配器', cmds: () => [{ cmd: 'esxcli storage core adapter list' }] }
    ]
  },
  {
    group: '网络',
    items: [
      { name: '网卡列表', cmds: () => [{ cmd: 'esxcli network nic list' }] },
      { name: 'IP 接口列表', cmds: () => [{ cmd: 'esxcli network ip interface list' }] },
      { name: '路由表', cmds: () => [{ cmd: 'esxcli network ip route ipv4 list' }] },
      { name: 'DNS 配置', cmds: () => [{ cmd: 'esxcli network ip dns search list' }, { cmd: 'esxcli network ip dns server list' }] },
      {
        name: 'VMkernel Ping',
        params: [{ key: 'ip', label: '目标 IP', placeholder: '192.168.1.1' }],
        cmds: v => [{ cmd: `vmkping -I vmk0 ${v.ip}` }]
      }
    ]
  },
  {
    group: '虚拟机',
    items: [
      { name: '虚拟机列表', cmds: () => [{ cmd: 'vim-cmd vmsvc/getallvms' }] },
      { name: 'VM 进程列表', cmds: () => [{ cmd: 'esxcli vm process list' }] },
      {
        name: 'VM 电源状态',
        params: [{ key: 'vmid', label: 'VM ID', placeholder: '1' }],
        cmds: v => [{ cmd: `vim-cmd vmsvc/power.getstate ${v.vmid}` }]
      },
      {
        name: 'VM 配置信息',
        params: [{ key: 'vmid', label: 'VM ID', placeholder: '1' }],
        cmds: v => [{ cmd: `vim-cmd vmsvc/get.config ${v.vmid}` }]
      }
    ]
  },
  {
    group: '系统',
    items: [
      { name: '进入维护模式', cmds: () => [{ cmd: 'esxcli system maintenanceMode set --enable true' }] },
      { name: '退出维护模式', cmds: () => [{ cmd: 'esxcli system maintenanceMode set --enable false' }] },
      { name: '硬件信息', cmds: () => [{ cmd: 'esxcli hardware platform get' }] },
      { name: '已安装软件包', cmds: () => [{ cmd: 'esxcli software vib list' }] },
      { name: '性能监控（esxtop）', cmds: () => [{ cmd: 'esxtop' }] },
      { name: '核心转储文件', cmds: () => [{ cmd: 'esxcli system coredump file list' }] },
      { name: '重启管理代理', cmds: () => [{ cmd: '/etc/init.d/hostd restart' }, { cmd: '/etc/init.d/vpxa restart' }] }
    ]
  }
];

const CITRIX_GROUPS = [
  {
    group: 'Citrix DaaS（PowerShell SDK）',
    items: [
      { name: '会话列表', cmds: () => [{ cmd: 'Get-BrokerSession -AdminAddress <DDC>' }] },
      { name: '桌面列表', cmds: () => [{ cmd: 'Get-BrokerDesktop -AdminAddress <DDC>' }] },
      { name: '机器列表', cmds: () => [{ cmd: 'Get-BrokerMachine -AdminAddress <DDC>' }] },
      { name: '应用列表', cmds: () => [{ cmd: 'Get-BrokerApplication -AdminAddress <DDC>' }] },
      { name: '桌面组', cmds: () => [{ cmd: 'Get-BrokerDesktopGroup' }] },
      {
        name: '重启机器',
        params: [{ key: 'machine', label: '机器名', placeholder: 'DOMAIN\\VM01' }],
        cmds: v => [{ cmd: `Restart-BrokerMachine -MachineName ${v.machine}` }]
      },
      {
        name: '断开会话',
        params: [{ key: 'sid', label: 'SessionId', placeholder: '123' }],
        cmds: v => [{ cmd: `Disconnect-BrokerSession -SessionId ${v.sid}` }]
      },
      {
        name: '按用户查会话',
        params: [{ key: 'user', label: '用户 UPN', placeholder: 'user@domain.com' }],
        cmds: v => [{ cmd: `Get-BrokerSession -User ${v.user}` }]
      }
    ]
  },
  {
    group: 'NetScaler（NS CLI）',
    items: [
      { name: '运行配置', cmds: () => [{ cmd: 'show ns config' }] },
      { name: '负载均衡 vServer', cmds: () => [{ cmd: 'show lb vserver' }] },
      { name: '内容交换 vServer', cmds: () => [{ cmd: 'show cs vserver' }] },
      { name: '服务列表', cmds: () => [{ cmd: 'show service' }] },
      { name: '服务器列表', cmds: () => [{ cmd: 'show server' }] },
      { name: 'VPN vServer', cmds: () => [{ cmd: 'show vpn vserver' }] },
      { name: '接口状态', cmds: () => [{ cmd: 'stat interface' }] },
      { name: 'SSL 状态', cmds: () => [{ cmd: 'stat ssl' }] }
    ]
  }
];

const PORTS = [
  [20, 'TCP', 'FTP 数据传输'], [21, 'TCP', 'FTP 控制连接'], [22, 'TCP/UDP', 'SSH / SFTP 远程登录'],
  [23, 'TCP', 'Telnet（明文，已淘汰）'], [25, 'TCP', 'SMTP 邮件发送'], [53, 'TCP/UDP', 'DNS 域名解析'],
  [67, 'UDP', 'DHCP 服务端'], [68, 'UDP', 'DHCP 客户端'], [69, 'UDP', 'TFTP 简单文件传输'],
  [80, 'TCP', 'HTTP 网页服务'], [88, 'TCP/UDP', 'Kerberos 认证'], [110, 'TCP', 'POP3 邮件接收'],
  [111, 'TCP/UDP', 'RPC 端口映射'], [123, 'UDP', 'NTP 时间同步'], [135, 'TCP/UDP', 'MS-RPC 远程过程调用'],
  [137, 'UDP', 'NetBIOS 名称服务'], [138, 'UDP', 'NetBIOS 数据报'], [139, 'TCP', 'NetBIOS 会话服务（SMB）'],
  [143, 'TCP', 'IMAP 邮件接收'], [161, 'UDP', 'SNMP 监控'], [162, 'UDP', 'SNMP Trap'],
  [389, 'TCP/UDP', 'LDAP 目录服务'], [427, 'UDP', 'SLP 服务定位'], [443, 'TCP', 'HTTPS 加密网页'],
  [445, 'TCP', 'SMB 文件共享'], [465, 'TCP', 'SMTPS 加密邮件提交'], [500, 'UDP', 'IPsec ISAKMP VPN'],
  [514, 'UDP', 'Syslog 日志'], [587, 'TCP', 'SMTP 邮件提交（STARTTLS）'], [631, 'TCP', 'IPP 打印服务'],
  [636, 'TCP', 'LDAPS 加密目录'], [873, 'TCP', 'rsync 同步'], [989, 'TCP', 'FTPS 数据'],
  [990, 'TCP', 'FTPS 控制'], [993, 'TCP', 'IMAPS 加密邮件'], [995, 'TCP', 'POP3S 加密邮件'],
  [1080, 'TCP', 'SOCKS 代理'], [1194, 'UDP', 'OpenVPN'], [1433, 'TCP', 'SQL Server 数据库'],
  [1521, 'TCP', 'Oracle 数据库'], [1723, 'TCP', 'PPTP VPN'], [2049, 'TCP/UDP', 'NFS 网络文件系统'],
  [2082, 'TCP', 'cPanel'], [2083, 'TCP', 'cPanel (SSL)'], [2181, 'TCP', 'ZooKeeper'],
  [2375, 'TCP', 'Docker API（明文）'], [2376, 'TCP', 'Docker API（TLS）'], [3000, 'TCP', '开发常用端口'],
  [3306, 'TCP', 'MySQL 数据库'], [3389, 'TCP', 'RDP 远程桌面'], [5000, 'TCP', '开发 / UPnP'],
  [5060, 'UDP', 'SIP 语音通话'], [5432, 'TCP', 'PostgreSQL 数据库'], [5900, 'TCP', 'VNC 远程桌面'],
  [5985, 'TCP', 'WinRM（HTTP）'], [5986, 'TCP', 'WinRM（HTTPS）'], [6379, 'TCP', 'Redis'],
  [6443, 'TCP', 'Kubernetes API'], [8000, 'TCP', '开发常用端口'], [8080, 'TCP', 'HTTP 代理 / 备用'],
  [8443, 'TCP', 'HTTPS 备用'], [8848, 'TCP', 'Nacos 注册中心'], [9000, 'TCP', 'MinIO / Portainer'],
  [9042, 'TCP', 'Cassandra'], [9200, 'TCP', 'Elasticsearch'], [11211, 'TCP', 'Memcached'],
  [15672, 'TCP', 'RabbitMQ 管理台'], [27017, 'TCP', 'MongoDB'], [50000, 'TCP', 'SAP'],
  [50070, 'TCP', 'HDFS NameNode Web'], [50075, 'TCP', 'HDFS DataNode Web']
];

const HTTP_CODES = [
  [100, 'Continue', '继续，客户端应继续发送请求体'],
  [101, 'Switching Protocols', '切换协议（如 WebSocket 升级）'],
  [200, 'OK', '请求成功'],
  [201, 'Created', '资源创建成功'],
  [204, 'No Content', '成功但无返回内容'],
  [206, 'Partial Content', '范围请求成功（断点续传）'],
  [301, 'Moved Permanently', '永久重定向'],
  [302, 'Found', '临时重定向'],
  [304, 'Not Modified', '缓存未修改，使用本地缓存'],
  [307, 'Temporary Redirect', '临时重定向（保持方法）'],
  [308, 'Permanent Redirect', '永久重定向（保持方法）'],
  [400, 'Bad Request', '请求语法错误'],
  [401, 'Unauthorized', '未认证，需要登录'],
  [403, 'Forbidden', '无权限访问'],
  [404, 'Not Found', '资源不存在'],
  [405, 'Method Not Allowed', '请求方法不允许'],
  [408, 'Request Timeout', '请求超时'],
  [409, 'Conflict', '资源冲突'],
  [413, 'Payload Too Large', '请求体过大'],
  [415, 'Unsupported Media Type', '不支持的媒体类型'],
  [429, 'Too Many Requests', '请求过于频繁（限流）'],
  [500, 'Internal Server Error', '服务器内部错误'],
  [502, 'Bad Gateway', '网关错误（上游无响应）'],
  [503, 'Service Unavailable', '服务不可用（过载 / 维护）'],
  [504, 'Gateway Timeout', '网关超时']
];

const CATS = ['网络', 'Windows', 'Linux', 'VMware', 'Citrix', '文本', '实用'];

const TOOLS = [
  {
    id: 'cidr', name: 'CIDR / 子网计算', icon: '🌐', cat: '网络',
    desc: 'IP 地址、子网掩码、广播地址、可用 IP 范围一键计算',
    keywords: 'cidr 子网 掩码 广播 网络地址 ip 计算 网段',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>输入 IP / CIDR</label>
        <div class="row">
          <input id="cidrInput" placeholder="如 192.168.1.100/24 或 10.0.0.0/255.0.0.0" />
          <button class="btn" id="cidrCalc">计算</button>
        </div>
        <div class="hint">支持：192.168.1.0/24、192.168.1.0/255.255.255.0、纯 IP（默认按 /24）</div>
      </div>
      <div id="cidrResult"></div>`;
      const input = $('#cidrInput', el);
      const res = $('#cidrResult', el);
      const calc = () => { res.innerHTML = calcCIDR(input.value.trim()); };
      $('#cidrCalc', el).onclick = calc;
      input.onkeydown = e => { if (e.key === 'Enter') calc(); };
      input.focus();
    }
  },
  {
    id: 'port-table', name: '常用端口表', icon: '🔌', cat: '网络',
    desc: '常见 TCP/UDP 端口与服务对照表，支持搜索',
    keywords: '端口 port 服务 对照表',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <input id="portFilter" placeholder="搜索端口 / 服务 / 协议，如：3389、MySQL…" />
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>端口</th><th>协议</th><th>服务 / 说明</th></tr></thead>
        <tbody id="portBody"></tbody>
      </table></div>`;
      const draw = q => {
        const kw = (q || '').trim().toLowerCase();
        const rows = PORTS.filter(p => !kw || String(p[0]).includes(kw) || p[1].toLowerCase().includes(kw) || p[2].toLowerCase().includes(kw));
        $('#portBody', el).innerHTML = rows.map(p => `<tr><td><code>${p[0]}</code></td><td>${p[1]}</td><td>${p[2]}</td></tr>`).join('') || '<tr><td colspan="3" class="empty">无匹配结果</td></tr>';
      };
      draw('');
      $('#portFilter', el).addEventListener('input', e => draw(e.target.value));
    }
  },
  {
    id: 'http-status', name: 'HTTP 状态码', icon: '📡', cat: '网络',
    desc: '常见 HTTP 状态码含义速查',
    keywords: 'http 状态码 status code 404 500',
    render(el) {
      const badge = code => {
        const c = Math.floor(code / 100);
        return `<span class="badge b${c}xx">${c}xx</span>`;
      };
      el.innerHTML = `
      <div class="card">
        <input id="httpFilter" placeholder="搜索状态码 / 描述，如：404、超时…" />
      </div>
      <div class="table-wrap"><table class="tbl">
        <thead><tr><th>分类</th><th>状态码</th><th>含义</th><th>说明</th></tr></thead>
        <tbody id="httpBody"></tbody>
      </table></div>`;
      const draw = q => {
        const kw = (q || '').trim().toLowerCase();
        const rows = HTTP_CODES.filter(r => !kw || String(r[0]).includes(kw) || r[1].toLowerCase().includes(kw) || r[2].includes(kw));
        $('#httpBody', el).innerHTML = rows.map(r => `<tr><td>${badge(r[0])}</td><td><code>${r[0]}</code></td><td>${r[1]}</td><td>${r[2]}</td></tr>`).join('') || '<tr><td colspan="4" class="empty">无匹配结果</td></tr>';
      };
      draw('');
      $('#httpFilter', el).addEventListener('input', e => draw(e.target.value));
    }
  },
  {
    id: 'win-cmds', name: 'Windows 命令生成器', icon: '🪟', cat: 'Windows',
    desc: 'PowerShell 命令：端口、服务、进程、磁盘、网络、用户',
    keywords: 'windows powershell 命令 端口 服务 进程 磁盘 网络 用户',
    render(el) { cmdGen(el, WIN_GROUPS, '生成 PowerShell 命令，在 PowerShell 或 CMD 中执行。'); }
  },
  {
    id: 'linux-cmds', name: 'Linux 命令生成器', icon: '🐧', cat: 'Linux',
    desc: '常用 Shell 命令：CPU、内存、磁盘、端口、进程、服务、日志',
    keywords: 'linux shell 命令 cpu 内存 磁盘 端口 进程 服务 日志 systemctl',
    render(el) { cmdGen(el, LINUX_GROUPS, '生成 Bash 命令，在 Linux Shell 中执行。'); }
  },
  {
    id: 'vmware-cmds', name: 'VMware ESXi 常用命令', icon: '🖥️', cat: 'VMware',
    desc: 'esxcli / vim-cmd 常用运维命令速查',
    keywords: 'vmware esxi esxcli vim-cmd 虚拟机 存储 网络',
    render(el) { cmdGen(el, VMWARE_GROUPS, '以下命令在 ESXi Shell / SSH 中执行。'); }
  },
  {
    id: 'citrix-cmds', name: 'Citrix / NetScaler 命令', icon: '🏢', cat: 'Citrix',
    desc: 'Citrix DaaS PowerShell SDK 与 NetScaler CLI 常用命令',
    keywords: 'citrix netscaler daaas powershell broker session vserver',
    render(el) { cmdGen(el, CITRIX_GROUPS, 'Citrix 命令需在安装了对应 PowerShell SDK 或 NetScaler CLI 的环境执行。'); }
  },
  {
    id: 'base64', name: 'Base64 编解码', icon: '🔐', cat: '文本',
    desc: 'Base64 编码与解码，支持中文',
    keywords: 'base64 编码 解码 encode decode',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>输入文本</label>
        <textarea id="b64in" placeholder="输入要编码的文本…"></textarea>
        <div class="btn-row">
          <button class="btn" id="b64enc">编码 Base64</button>
          <button class="btn ghost" id="b64dec">解码 Base64</button>
          <button class="btn ghost" id="b64swap">⇄ 交换</button>
        </div>
        <label>输出结果</label>
        <textarea id="b64out" placeholder="结果…"></textarea>
        <div class="btn-row">
          <button class="btn small" id="b64copy">复制结果</button>
          <button class="btn small ghost" id="b64clear">清空</button>
        </div>
        <div class="hint" id="b64msg"></div>
      </div>`;
      const msg = $('#b64msg', el);
      const enc = s => btoa(Array.from(new TextEncoder().encode(s)).map(b => String.fromCharCode(b)).join(''));
      const dec = s => new TextDecoder().decode(Uint8Array.from(atob(s), c => c.charCodeAt(0)));
      $('#b64enc', el).onclick = () => { try { $('#b64out', el).value = enc($('#b64in', el).value); msg.textContent = ''; } catch (e) { msg.textContent = '编码失败：' + e.message; } };
      $('#b64dec', el).onclick = () => { try { $('#b64out', el).value = dec($('#b64in', el).value); msg.textContent = ''; } catch (e) { msg.textContent = '解码失败：输入不是合法的 Base64'; } };
      $('#b64swap', el).onclick = () => { const t = $('#b64in', el).value; $('#b64in', el).value = $('#b64out', el).value; $('#b64out', el).value = t; };
      $('#b64copy', el).onclick = () => copyText($('#b64out', el).value, $('#b64copy', el));
      $('#b64clear', el).onclick = () => { $('#b64in', el).value = ''; $('#b64out', el).value = ''; msg.textContent = ''; };
    }
  },
  {
    id: 'json', name: 'JSON 格式化', icon: '📝', cat: '文本',
    desc: 'JSON 格式化、压缩与语法校验',
    keywords: 'json 格式化 压缩 校验 format minify',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>JSON 输入</label>
        <textarea id="jsIn" placeholder='{"name":"ops","tools":["ping","ssh"]}'></textarea>
        <div class="btn-row">
          <button class="btn" id="jsFmt">格式化</button>
          <button class="btn" id="jsMin">压缩</button>
          <button class="btn ghost" id="jsVal">仅校验</button>
        </div>
        <label>输出</label>
        <pre id="jsOut"></pre>
        <div class="hint" id="jsMsg"></div>
      </div>`;
      const run = mode => {
        const s = $('#jsIn', el).value;
        const out = $('#jsOut', el);
        const msg = $('#jsMsg', el);
        try {
          const obj = JSON.parse(s);
          out.textContent = mode === 'min' ? JSON.stringify(obj) : JSON.stringify(obj, null, 2);
          msg.textContent = mode === 'val' ? '✓ JSON 格式正确' : '';
          msg.className = 'hint ok';
        } catch (e) {
          out.textContent = '';
          msg.textContent = '✗ ' + e.message;
          msg.className = 'hint err';
        }
      };
      $('#jsFmt', el).onclick = () => run('fmt');
      $('#jsMin', el).onclick = () => run('min');
      $('#jsVal', el).onclick = () => run('val');
    }
  },
  {
    id: 'urlcode', name: 'URL 编解码', icon: '🔗', cat: '文本',
    desc: 'URL Encode / Decode，支持中文',
    keywords: 'url encode decode 编码 解码 百分号',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>输入文本</label>
        <textarea id="urlIn" placeholder="输入要编码的文本…"></textarea>
        <div class="btn-row">
          <button class="btn" id="urlEnc">URL 编码</button>
          <button class="btn ghost" id="urlDec">URL 解码</button>
          <button class="btn ghost" id="urlSwap">⇄ 交换</button>
        </div>
        <label>输出结果</label>
        <textarea id="urlOut" placeholder="结果…"></textarea>
        <div class="btn-row">
          <button class="btn small" id="urlCopy">复制结果</button>
          <button class="btn small ghost" id="urlClear">清空</button>
        </div>
        <div class="hint" id="urlMsg"></div>
      </div>`;
      const msg = $('#urlMsg', el);
      $('#urlEnc', el).onclick = () => { try { $('#urlOut', el).value = encodeURIComponent($('#urlIn', el).value); msg.textContent = ''; } catch (e) { msg.textContent = '编码失败：' + e.message; } };
      $('#urlDec', el).onclick = () => { try { $('#urlOut', el).value = decodeURIComponent($('#urlIn', el).value); msg.textContent = ''; } catch (e) { msg.textContent = '解码失败：存在非法的转义序列'; } };
      $('#urlSwap', el).onclick = () => { const t = $('#urlIn', el).value; $('#urlIn', el).value = $('#urlOut', el).value; $('#urlOut', el).value = t; };
      $('#urlCopy', el).onclick = () => copyText($('#urlOut', el).value, $('#urlCopy', el));
      $('#urlClear', el).onclick = () => { $('#urlIn', el).value = ''; $('#urlOut', el).value = ''; msg.textContent = ''; };
    }
  },
  {
    id: 'timestamp', name: '时间戳转换', icon: '⏱️', cat: '文本',
    desc: '秒 / 毫秒时间戳与日期互转',
    keywords: '时间戳 timestamp 秒 毫秒 日期 unix',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>当前时间</label>
        <div class="ts-now">
          <div class="ts-row"><span>秒级 (s)</span><div class="ts-val"><code id="tsS">-</code><button class="btn small" id="cpS">复制</button></div></div>
          <div class="ts-row"><span>毫秒级 (ms)</span><div class="ts-val"><code id="tsM">-</code><button class="btn small" id="cpM">复制</button></div></div>
          <div class="ts-row"><span>本地时间</span><div class="ts-val"><code id="tsL">-</code></div></div>
          <div class="ts-row"><span>UTC 时间</span><div class="ts-val"><code id="tsU">-</code></div></div>
        </div>
      </div>
      <div class="card">
        <label>时间戳 → 日期</label>
        <input id="tsIn" placeholder="输入秒或毫秒时间戳，如 1700000000" />
        <div class="hint" id="tsInOut"></div>
      </div>
      <div class="card">
        <label>日期 → 时间戳</label>
        <input id="tsDate" type="datetime-local" />
        <div class="hint" id="tsDateOut"></div>
      </div>`;
      const tick = () => {
        const now = Date.now();
        $('#tsS', el).textContent = Math.floor(now / 1000);
        $('#tsM', el).textContent = now;
        const d = new Date(now);
        $('#tsL', el).textContent = d.toLocaleString('zh-CN', { hour12: false });
        $('#tsU', el).textContent = d.toISOString().replace('T', ' ').slice(0, 19) + ' UTC';
      };
      tick();
      const timer = setInterval(tick, 1000);
      cleanup(() => clearInterval(timer));
      $('#cpS', el).onclick = () => copyText($('#tsS', el).textContent, $('#cpS', el));
      $('#cpM', el).onclick = () => copyText($('#tsM', el).textContent, $('#cpM', el));
      $('#tsIn', el).addEventListener('input', () => {
        const v = $('#tsIn', el).value.trim();
        const box = $('#tsInOut', el);
        if (!v) { box.textContent = ''; return; }
        const n = Number(v);
        if (!Number.isFinite(n)) { box.textContent = '请输入数字'; box.className = 'hint err'; return; }
        const ms = Math.abs(n) <= 1e11 ? n * 1000 : n;
        const d = new Date(ms);
        if (isNaN(d.getTime())) { box.textContent = '无法解析的时间戳'; box.className = 'hint err'; return; }
        box.className = 'hint';
        box.textContent = `本地：${d.toLocaleString('zh-CN', { hour12: false })}　UTC：${d.toISOString().replace('T', ' ').slice(0, 19)}`;
      });
      const d0 = new Date(Date.now() - new Date().getTimezoneOffset() * 60000);
      $('#tsDate', el).value = d0.toISOString().slice(0, 16);
      const dateOut = () => {
        const v = $('#tsDate', el).value;
        if (!v) { $('#tsDateOut', el).textContent = ''; return; }
        const d = new Date(v);
        $('#tsDateOut', el).textContent = `秒：${Math.floor(d.getTime() / 1000)}　毫秒：${d.getTime()}`;
      };
      dateOut();
      $('#tsDate', el).addEventListener('input', dateOut);
    }
  },
  {
    id: 'uuid', name: 'UUID 生成器', icon: '🆔', cat: '实用',
    desc: '批量生成 UUID v4',
    keywords: 'uuid guid 生成 随机',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <div class="row">
          <select id="uuidN">
            <option value="1">1 个</option>
            <option value="5" selected>5 个</option>
            <option value="10">10 个</option>
            <option value="20">20 个</option>
          </select>
          <button class="btn" id="uuidGen">生成 UUID</button>
          <button class="btn ghost" id="uuidCopy">复制全部</button>
        </div>
        <div id="uuidOut" class="uuid-list"></div>
      </div>`;
      let last = [];
      const gen = () => {
        const n = +$('#uuidN', el).value;
        last = Array.from({ length: n }, () => (crypto.randomUUID ? crypto.randomUUID() : fallbackUuid()));
        $('#uuidOut', el).innerHTML = last.map(u => `<div class="uuid-row"><code>${u}</code><button class="btn small" data-u="${u}">复制</button></div>`).join('');
        $$('#uuidOut button', el).forEach(b => { b.onclick = () => copyText(b.dataset.u, b); });
      };
      $('#uuidGen', el).onclick = gen;
      $('#uuidCopy', el).onclick = () => copyText(last.join('\n'), $('#uuidCopy', el));
      gen();
    }
  },
  {
    id: 'hash', name: 'Hash 摘要计算', icon: '🧮', cat: '实用',
    desc: 'SHA-256 / 384 / 512 摘要计算',
    keywords: 'hash sha256 sha512 摘要 指纹 md5',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>输入文本</label>
        <textarea id="hsIn" placeholder="输入要计算摘要的文本…"></textarea>
        <div class="row">
          <select id="hsAlgo">
            <option value="SHA-256">SHA-256</option>
            <option value="SHA-384">SHA-384</option>
            <option value="SHA-512">SHA-512</option>
          </select>
          <button class="btn" id="hsBtn">计算</button>
        </div>
        <label>摘要结果（Hex）</label>
        <pre id="hsOut">-</pre>
        <div class="hint" id="hsMsg"></div>
      </div>`;
      if (!crypto.subtle) {
        $('#hsMsg', el).textContent = '当前环境不支持 WebCrypto（需 HTTPS 或 localhost），无法计算摘要。';
        $('#hsBtn', el).disabled = true;
        return;
      }
      $('#hsBtn', el).onclick = async () => {
        const txt = $('#hsIn', el).value;
        const algo = $('#hsAlgo', el).value;
        try {
          const buf = await crypto.subtle.digest(algo, new TextEncoder().encode(txt));
          $('#hsOut', el).textContent = Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
          $('#hsMsg', el).textContent = '';
        } catch (e) {
          $('#hsMsg', el).textContent = '计算失败：' + e.message;
        }
      };
    }
  },
  {
    id: 'regex', name: '正则表达式测试', icon: '🔍', cat: '文本',
    desc: '在线测试正则表达式，支持常用模板与捕获组',
    keywords: 'regex 正则 匹配 测试 pattern 捕获组',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>正则表达式</label>
        <div class="row">
          <input id="rePattern" placeholder="如 \\d+\\.\\d+\\.\\d+\\.\\d+" />
          <select id="reFlags">
            <option value="g">全局 (g)</option>
            <option value="gi">全局+忽略大小写 (gi)</option>
            <option value="i">忽略大小写 (i)</option>
            <option value="m">多行 (m)</option>
          </select>
        </div>
        <div class="btn-row">
          <button class="btn small" data-tpl="email">邮箱</button>
          <button class="btn small" data-tpl="ip">IP 地址</button>
          <button class="btn small" data-tpl="phone">手机号</button>
          <button class="btn small" data-tpl="url">URL</button>
          <button class="btn small" data-tpl="date">日期</button>
          <button class="btn small" data-tpl="idcard">身份证</button>
        </div>
      </div>
      <div class="card">
        <label>测试文本</label>
        <textarea id="reText" rows="6" placeholder="输入要匹配的文本..."></textarea>
      </div>
      <div id="reResult"></div>`;
      const patterns = {
        email: '^[\\w.-]+@[\\w.-]+\\.[a-zA-Z]{2,}$',
        ip: '^(\\d{1,3}\\.){3}\\d{1,3}$',
        phone: '^1[3-9]\\d{9}$',
        url: '^https?://[\\w.-]+(?:\\.[a-zA-Z]{2,})+(?:/[^\\s]*)?$',
        date: '^\\d{4}-\\d{2}-\\d{2}$',
        idcard: '^\\d{17}[\\dXx]$'
      };
      const run = () => {
        const pattern = $('#rePattern', el).value;
        const flags = $('#reFlags', el).value;
        const text = $('#reText', el).value;
        const result = $('#reResult', el);
        if (!pattern) { result.innerHTML = '<div class="empty">请输入正则表达式</div>'; return; }
        let regex;
        try { regex = new RegExp(pattern, flags); } catch (e) { result.innerHTML = `<div class="empty">正则语法错误：${escapeHtml(e.message)}</div>`; return; }
        if (!text) { result.innerHTML = '<div class="empty">请输入测试文本</div>'; return; }
        const matches = [];
        let match;
        const globalRegex = new RegExp(pattern, flags.includes('g') ? flags : flags + 'g');
        while ((match = globalRegex.exec(text)) !== null) {
          matches.push({ text: match[0], index: match.index, groups: match.slice(1) });
          if (match[0] === '') globalRegex.lastIndex++;
        }
        if (matches.length === 0) { result.innerHTML = '<div class="empty">无匹配结果</div>'; return; }
        result.innerHTML = `
        <div class="card">
          <label>匹配结果（共 ${matches.length} 处）</label>
          ${matches.map((m, i) => `
            <div class="cmd">
              <div class="cmd-head"><span>匹配 ${i + 1} @ 位置 ${m.index}</span></div>
              <pre><code>${escapeHtml(m.text)}</code></pre>
              ${m.groups.length ? `<div class="hint">捕获组：${m.groups.map((g, j) => '$' + (j + 1) + ' = ' + escapeHtml(g)).join('，')}</div>` : ''}
            </div>`).join('')}
        </div>`;
      };
      $('#rePattern', el).addEventListener('input', run);
      $('#reFlags', el).addEventListener('change', run);
      $('#reText', el).addEventListener('input', run);
      $$('.btn-row .btn', el).forEach(btn => { btn.onclick = () => { $('#rePattern', el).value = patterns[btn.dataset.tpl]; run(); }; });
    }
  },
  {
    id: 'mac', name: 'MAC 地址工具', icon: '🔌', cat: '网络',
    desc: 'MAC 格式化、随机生成、厂商查询',
    keywords: 'mac 地址 厂商 oui 随机 格式化',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>MAC 地址</label>
        <input id="macInput" placeholder="如 00:1A:2B:3C:4D:5E 或 001A2B3C4D5E" />
        <div class="btn-row">
          <button class="btn" id="macFormat">格式化</button>
          <button class="btn ghost" id="macRandom">随机生成</button>
        </div>
        <div id="macResult"></div>
      </div>`;
      const formatMac = input => {
        const hex = input.replace(/[^0-9a-fA-F]/g, '');
        if (hex.length !== 12) return null;
        return hex.toUpperCase().match(/.{2}/g).join(':');
      };
      const oui = {
        '00:50:56': 'VMware', '00:0C:29': 'VMware', '00:16:3E': 'Xen',
        '08:00:27': 'VirtualBox', '52:54:00': 'QEMU/KVM', '00:15:5D': 'Microsoft Hyper-V',
        '00:1B:21': 'Intel', '00:1C:42': 'Parallels', 'B8:27:EB': 'Raspberry Pi',
        'DC:A6:32': 'Raspberry Pi', 'E4:5F:01': 'Raspberry Pi', '00:04:4B': 'NVIDIA',
        '00:14:22': 'Dell', '00:18:8B': 'Dell', '00:1A:A0': 'Dell', '00:21:70': 'Dell',
        '00:24:E8': 'Dell', '00:26:2D': 'Dell', 'F8:BC:12': 'Dell', 'F8:DB:7F': 'Dell',
        '00:0C:41': 'Samsung', '00:12:47': 'Samsung', '00:13:77': 'Samsung', '00:15:99': 'Samsung',
        '00:16:32': 'Samsung', '00:17:C9': 'Samsung', '00:18:AF': 'Samsung', '00:1A:8A': 'Samsung',
        '00:1B:98': 'Samsung', '00:1C:43': 'Samsung', '00:1D:F6': 'Samsung', '00:1E:7D': 'Samsung',
        '00:1F:CC': 'Samsung', '00:21:19': 'Samsung', '00:23:39': 'Samsung', '00:24:E9': 'Samsung',
        '00:25:66': 'Samsung', '00:26:37': 'Samsung', '00:0D:3A': 'Microsoft', '00:12:5A': 'Microsoft',
        '00:17:FA': 'Microsoft', '00:1D:D8': 'Microsoft', '00:22:48': 'Microsoft', '00:24:1D': 'Microsoft',
        '00:25:AE': 'Microsoft', '00:50:F2': 'Microsoft', '00:03:FF': 'Microsoft',
        '00:1A:2B': 'Cisco', '00:1B:0C': 'Cisco', '00:1C:58': 'Cisco', '00:1D:45': 'Cisco',
        '00:1E:14': 'Cisco', '00:1F:26': 'Cisco', '00:21:29': 'Cisco', '00:22:55': 'Cisco',
        '00:23:04': 'Cisco', '00:23:5D': 'Cisco', '00:24:13': 'Cisco', '00:24:50': 'Cisco',
        '00:24:F7': 'Cisco', '00:25:45': 'Cisco', '00:26:0A': 'Cisco', '00:26:51': 'Cisco',
        '00:26:98': 'Cisco', '00:27:0D': 'Cisco', '00:27:43': 'Cisco', '00:27:90': 'Cisco',
        '00:28:6F': 'Cisco', '00:29:2D': 'Cisco', '00:2A:19': 'Cisco', '00:2B:0C': 'Cisco',
        '00:2C:C8': 'Cisco', '00:2D:76': 'Cisco', '00:2E:3A': 'Cisco', '00:2F:3A': 'Cisco',
        '00:30:19': 'Cisco', '00:30:42': 'Cisco', '00:30:65': 'Cisco', '00:30:71': 'Cisco',
        '00:30:84': 'Cisco', '00:30:96': 'Cisco', '00:30:B5': 'Cisco', '00:30:F2': 'Cisco',
        '00:31:2F': 'Cisco', '00:31:42': 'Cisco', '00:31:5B': 'Cisco', '00:31:8E': 'Cisco',
        '00:31:BD': 'Cisco', '00:32:17': 'Cisco', '00:32:2D': 'Cisco', '00:32:4A': 'Cisco',
        '00:32:64': 'Cisco', '00:32:98': 'Cisco', '00:32:B7': 'Cisco', '00:32:DC': 'Cisco',
        '00:33:19': 'Cisco', '00:33:2F': 'Cisco', '00:33:42': 'Cisco', '00:33:5B': 'Cisco',
        '00:33:8E': 'Cisco', '00:33:BD': 'Cisco', '00:33:DA': 'Cisco', '00:33:F2': 'Cisco',
        '00:34:19': 'Cisco', '00:34:2F': 'Cisco', '00:34:42': 'Cisco', '00:34:5B': 'Cisco',
        '00:34:8E': 'Cisco', '00:34:BD': 'Cisco', '00:34:DA': 'Cisco', '00:34:F2': 'Cisco',
        '00:35:19': 'Cisco', '00:35:2F': 'Cisco', '00:35:42': 'Cisco', '00:35:5B': 'Cisco',
        '00:35:8E': 'Cisco', '00:35:BD': 'Cisco', '00:35:DA': 'Cisco', '00:35:F2': 'Cisco',
        '00:36:19': 'Cisco', '00:36:2F': 'Cisco', '00:36:42': 'Cisco', '00:36:5B': 'Cisco',
        '00:36:8E': 'Cisco', '00:36:BD': 'Cisco', '00:36:DA': 'Cisco', '00:36:F2': 'Cisco',
        '00:37:19': 'Cisco', '00:37:2F': 'Cisco', '00:37:42': 'Cisco', '00:37:5B': 'Cisco',
        '00:37:8E': 'Cisco', '00:37:BD': 'Cisco', '00:37:DA': 'Cisco', '00:37:F2': 'Cisco',
        '00:38:19': 'Cisco', '00:38:2F': 'Cisco', '00:38:42': 'Cisco', '00:38:5B': 'Cisco',
        '00:38:8E': 'Cisco', '00:38:BD': 'Cisco', '00:38:DA': 'Cisco', '00:38:F2': 'Cisco',
        '00:39:19': 'Cisco', '00:39:2F': 'Cisco', '00:39:42': 'Cisco', '00:39:5B': 'Cisco',
        '00:39:8E': 'Cisco', '00:39:BD': 'Cisco', '00:39:DA': 'Cisco', '00:39:F2': 'Cisco',
        '00:3A:19': 'Cisco', '00:3A:2F': 'Cisco', '00:3A:42': 'Cisco', '00:3A:5B': 'Cisco',
        '00:3A:8E': 'Cisco', '00:3A:BD': 'Cisco', '00:3A:DA': 'Cisco', '00:3A:F2': 'Cisco',
        '00:3B:19': 'Cisco', '00:3B:2F': 'Cisco', '00:3B:42': 'Cisco', '00:3B:5B': 'Cisco',
        '00:3B:8E': 'Cisco', '00:3B:BD': 'Cisco', '00:3B:DA': 'Cisco', '00:3B:F2': 'Cisco',
        '00:3C:19': 'Cisco', '00:3C:2F': 'Cisco', '00:3C:42': 'Cisco', '00:3C:5B': 'Cisco',
        '00:3C:8E': 'Cisco', '00:3C:BD': 'Cisco', '00:3C:DA': 'Cisco', '00:3C:F2': 'Cisco',
        '00:3D:19': 'Cisco', '00:3D:2F': 'Cisco', '00:3D:42': 'Cisco', '00:3D:5B': 'Cisco',
        '00:3D:8E': 'Cisco', '00:3D:BD': 'Cisco', '00:3D:DA': 'Cisco', '00:3D:F2': 'Cisco',
        '00:3E:19': 'Cisco', '00:3E:2F': 'Cisco', '00:3E:42': 'Cisco', '00:3E:5B': 'Cisco',
        '00:3E:8E': 'Cisco', '00:3E:BD': 'Cisco', '00:3E:DA': 'Cisco', '00:3E:F2': 'Cisco',
        '00:3F:19': 'Cisco', '00:3F:2F': 'Cisco', '00:3F:42': 'Cisco', '00:3F:5B': 'Cisco',
        '00:3F:8E': 'Cisco', '00:3F:BD': 'Cisco', '00:3F:DA': 'Cisco', '00:3F:F2': 'Cisco',
        '00:40:19': 'Cisco', '00:40:2F': 'Cisco', '00:40:42': 'Cisco', '00:40:5B': 'Cisco',
        '00:40:8E': 'Cisco', '00:40:BD': 'Cisco', '00:40:DA': 'Cisco', '00:40:F2': 'Cisco',
        '00:41:19': 'Cisco', '00:41:2F': 'Cisco', '00:41:42': 'Cisco', '00:41:5B': 'Cisco',
        '00:41:8E': 'Cisco', '00:41:BD': 'Cisco', '00:41:DA': 'Cisco', '00:41:F2': 'Cisco',
        '00:42:19': 'Cisco', '00:42:2F': 'Cisco', '00:42:42': 'Cisco', '00:42:5B': 'Cisco',
        '00:42:8E': 'Cisco', '00:42:BD': 'Cisco', '00:42:DA': 'Cisco', '00:42:F2': 'Cisco',
        '00:43:19': 'Cisco', '00:43:2F': 'Cisco', '00:43:42': 'Cisco', '00:43:5B': 'Cisco',
        '00:43:8E': 'Cisco', '00:43:BD': 'Cisco', '00:43:DA': 'Cisco', '00:43:F2': 'Cisco',
        '00:44:19': 'Cisco', '00:44:2F': 'Cisco', '00:44:42': 'Cisco', '00:44:5B': 'Cisco',
        '00:44:8E': 'Cisco', '00:44:BD': 'Cisco', '00:44:DA': 'Cisco', '00:44:F2': 'Cisco',
        '00:45:19': 'Cisco', '00:45:2F': 'Cisco', '00:45:42': 'Cisco', '00:45:5B': 'Cisco',
        '00:45:8E': 'Cisco', '00:45:BD': 'Cisco', '00:45:DA': 'Cisco', '00:45:F2': 'Cisco',
        '00:46:19': 'Cisco', '00:46:2F': 'Cisco', '00:46:42': 'Cisco', '00:46:5B': 'Cisco',
        '00:46:8E': 'Cisco', '00:46:BD': 'Cisco', '00:46:DA': 'Cisco', '00:46:F2': 'Cisco',
        '00:47:19': 'Cisco', '00:47:2F': 'Cisco', '00:47:42': 'Cisco', '00:47:5B': 'Cisco',
        '00:47:8E': 'Cisco', '00:47:BD': 'Cisco', '00:47:DA': 'Cisco', '00:47:F2': 'Cisco',
        '00:48:19': 'Cisco', '00:48:2F': 'Cisco', '00:48:42': 'Cisco', '00:48:5B': 'Cisco',
        '00:48:8E': 'Cisco', '00:48:BD': 'Cisco', '00:48:DA': 'Cisco', '00:48:F2': 'Cisco',
        '00:49:19': 'Cisco', '00:49:2F': 'Cisco', '00:49:42': 'Cisco', '00:49:5B': 'Cisco',
        '00:49:8E': 'Cisco', '00:49:BD': 'Cisco', '00:49:DA': 'Cisco', '00:49:F2': 'Cisco',
        '00:4A:19': 'Cisco', '00:4A:2F': 'Cisco', '00:4A:42': 'Cisco', '00:4A:5B': 'Cisco',
        '00:4A:8E': 'Cisco', '00:4A:BD': 'Cisco', '00:4A:DA': 'Cisco', '00:4A:F2': 'Cisco',
        '00:4B:19': 'Cisco', '00:4B:2F': 'Cisco', '00:4B:42': 'Cisco', '00:4B:5B': 'Cisco',
        '00:4B:8E': 'Cisco', '00:4B:BD': 'Cisco', '00:4B:DA': 'Cisco', '00:4B:F2': 'Cisco',
        '00:4C:19': 'Cisco', '00:4C:2F': 'Cisco', '00:4C:42': 'Cisco', '00:4C:5B': 'Cisco',
        '00:4C:8E': 'Cisco', '00:4C:BD': 'Cisco', '00:4C:DA': 'Cisco', '00:4C:F2': 'Cisco',
        '00:4D:19': 'Cisco', '00:4D:2F': 'Cisco', '00:4D:42': 'Cisco', '00:4D:5B': 'Cisco',
        '00:4D:8E': 'Cisco', '00:4D:BD': 'Cisco', '00:4D:DA': 'Cisco', '00:4D:F2': 'Cisco',
        '00:4E:19': 'Cisco', '00:4E:2F': 'Cisco', '00:4E:42': 'Cisco', '00:4E:5B': 'Cisco',
        '00:4E:8E': 'Cisco', '00:4E:BD': 'Cisco', '00:4E:DA': 'Cisco', '00:4E:F2': 'Cisco',
        '00:4F:19': 'Cisco', '00:4F:2F': 'Cisco', '00:4F:42': 'Cisco', '00:4F:5B': 'Cisco',
        '00:4F:8E': 'Cisco', '00:4F:BD': 'Cisco', '00:4F:DA': 'Cisco', '00:4F:F2': 'Cisco',
        '00:50:19': 'Cisco', '00:50:2F': 'Cisco', '00:50:42': 'Cisco', '00:50:5B': 'Cisco',
        '00:50:8E': 'Cisco', '00:50:BD': 'Cisco', '00:50:DA': 'Cisco', '00:50:F2': 'Cisco',
        '00:51:19': 'Cisco', '00:51:2F': 'Cisco', '00:51:42': 'Cisco', '00:51:5B': 'Cisco',
        '00:51:8E': 'Cisco', '00:51:BD': 'Cisco', '00:51:DA': 'Cisco', '00:51:F2': 'Cisco',
        '00:52:19': 'Cisco', '00:52:2F': 'Cisco', '00:52:42': 'Cisco', '00:52:5B': 'Cisco',
        '00:52:8E': 'Cisco', '00:52:BD': 'Cisco', '00:52:DA': 'Cisco', '00:52:F2': 'Cisco',
        '00:53:19': 'Cisco', '00:53:2F': 'Cisco', '00:53:42': 'Cisco', '00:53:5B': 'Cisco',
        '00:53:8E': 'Cisco', '00:53:BD': 'Cisco', '00:53:DA': 'Cisco', '00:53:F2': 'Cisco',
        '00:54:19': 'Cisco', '00:54:2F': 'Cisco', '00:54:42': 'Cisco', '00:54:5B': 'Cisco',
        '00:54:8E': 'Cisco', '00:54:BD': 'Cisco', '00:54:DA': 'Cisco', '00:54:F2': 'Cisco',
        '00:55:19': 'Cisco', '00:55:2F': 'Cisco', '00:55:42': 'Cisco', '00:55:5B': 'Cisco',
        '00:55:8E': 'Cisco', '00:55:BD': 'Cisco', '00:55:DA': 'Cisco', '00:55:F2': 'Cisco',
        '00:56:19': 'Cisco', '00:56:2F': 'Cisco', '00:56:42': 'Cisco', '00:56:5B': 'Cisco',
        '00:56:8E': 'Cisco', '00:56:BD': 'Cisco', '00:56:DA': 'Cisco', '00:56:F2': 'Cisco',
        '00:57:19': 'Cisco', '00:57:2F': 'Cisco', '00:57:42': 'Cisco', '00:57:5B': 'Cisco',
        '00:57:8E': 'Cisco', '00:57:BD': 'Cisco', '00:57:DA': 'Cisco', '00:57:F2': 'Cisco',
        '00:58:19': 'Cisco', '00:58:2F': 'Cisco', '00:58:42': 'Cisco', '00:58:5B': 'Cisco',
        '00:58:8E': 'Cisco', '00:58:BD': 'Cisco', '00:58:DA': 'Cisco', '00:58:F2': 'Cisco',
        '00:59:19': 'Cisco', '00:59:2F': 'Cisco', '00:59:42': 'Cisco', '00:59:5B': 'Cisco',
        '00:59:8E': 'Cisco', '00:59:BD': 'Cisco', '00:59:DA': 'Cisco', '00:59:F2': 'Cisco',
        '00:5A:19': 'Cisco', '00:5A:2F': 'Cisco', '00:5A:42': 'Cisco', '00:5A:5B': 'Cisco',
        '00:5A:8E': 'Cisco', '00:5A:BD': 'Cisco', '00:5A:DA': 'Cisco', '00:5A:F2': 'Cisco',
        '00:5B:19': 'Cisco', '00:5B:2F': 'Cisco', '00:5B:42': 'Cisco', '00:5B:5B': 'Cisco',
        '00:5B:8E': 'Cisco', '00:5B:BD': 'Cisco', '00:5B:DA': 'Cisco', '00:5B:F2': 'Cisco',
        '00:5C:19': 'Cisco', '00:5C:2F': 'Cisco', '00:5C:42': 'Cisco', '00:5C:5B': 'Cisco',
        '00:5C:8E': 'Cisco', '00:5C:BD': 'Cisco', '00:5C:DA': 'Cisco', '00:5C:F2': 'Cisco',
        '00:5D:19': 'Cisco', '00:5D:2F': 'Cisco', '00:5D:42': 'Cisco', '00:5D:5B': 'Cisco',
        '00:5D:8E': 'Cisco', '00:5D:BD': 'Cisco', '00:5D:DA': 'Cisco', '00:5D:F2': 'Cisco',
        '00:5E:19': 'Cisco', '00:5E:2F': 'Cisco', '00:5E:42': 'Cisco', '00:5E:5B': 'Cisco',
        '00:5E:8E': 'Cisco', '00:5E:BD': 'Cisco', '00:5E:DA': 'Cisco', '00:5E:F2': 'Cisco',
        '00:5F:19': 'Cisco', '00:5F:2F': 'Cisco', '00:5F:42': 'Cisco', '00:5F:5B': 'Cisco',
        '00:5F:8E': 'Cisco', '00:5F:BD': 'Cisco', '00:5F:DA': 'Cisco', '00:5F:F2': 'Cisco',
        '00:60:19': 'Cisco', '00:60:2F': 'Cisco', '00:60:42': 'Cisco', '00:60:5B': 'Cisco',
        '00:60:8E': 'Cisco', '00:60:BD': 'Cisco', '00:60:DA': 'Cisco', '00:60:F2': 'Cisco',
        '00:61:19': 'Cisco', '00:61:2F': 'Cisco', '00:61:42': 'Cisco', '00:61:5B': 'Cisco',
        '00:61:8E': 'Cisco', '00:61:BD': 'Cisco', '00:61:DA': 'Cisco', '00:61:F2': 'Cisco',
        '00:62:19': 'Cisco', '00:62:2F': 'Cisco', '00:62:42': 'Cisco', '00:62:5B': 'Cisco',
        '00:62:8E': 'Cisco', '00:62:BD': 'Cisco', '00:62:DA': 'Cisco', '00:62:F2': 'Cisco',
        '00:63:19': 'Cisco', '00:63:2F': 'Cisco', '00:63:42': 'Cisco', '00:63:5B': 'Cisco',
        '00:63:8E': 'Cisco', '00:63:BD': 'Cisco', '00:63:DA': 'Cisco', '00:63:F2': 'Cisco',
        '00:64:19': 'Cisco', '00:64:2F': 'Cisco', '00:64:42': 'Cisco', '00:64:5B': 'Cisco',
        '00:64:8E': 'Cisco', '00:64:BD': 'Cisco', '00:64:DA': 'Cisco', '00:64:F2': 'Cisco',
        '00:65:19': 'Cisco', '00:65:2F': 'Cisco', '00:65:42': 'Cisco', '00:65:5B': 'Cisco',
        '00:65:8E': 'Cisco', '00:65:BD': 'Cisco', '00:65:DA': 'Cisco', '00:65:F2': 'Cisco',
        '00:66:19': 'Cisco', '00:66:2F': 'Cisco', '00:66:42': 'Cisco', '00:66:5B': 'Cisco',
        '00:66:8E': 'Cisco', '00:66:BD': 'Cisco', '00:66:DA': 'Cisco', '00:66:F2': 'Cisco',
        '00:67:19': 'Cisco', '00:67:2F': 'Cisco', '00:67:42': 'Cisco', '00:67:5B': 'Cisco',
        '00:67:8E': 'Cisco', '00:67:BD': 'Cisco', '00:67:DA': 'Cisco', '00:67:F2': 'Cisco',
        '00:68:19': 'Cisco', '00:68:2F': 'Cisco', '00:68:42': 'Cisco', '00:68:5B': 'Cisco',
        '00:68:8E': 'Cisco', '00:68:BD': 'Cisco', '00:68:DA': 'Cisco', '00:68:F2': 'Cisco',
        '00:69:19': 'Cisco', '00:69:2F': 'Cisco', '00:69:42': 'Cisco', '00:69:5B': 'Cisco',
        '00:69:8E': 'Cisco', '00:69:BD': 'Cisco', '00:69:DA': 'Cisco', '00:69:F2': 'Cisco',
        '00:6A:19': 'Cisco', '00:6A:2F': 'Cisco', '00:6A:42': 'Cisco', '00:6A:5B': 'Cisco',
        '00:6A:8E': 'Cisco', '00:6A:BD': 'Cisco', '00:6A:DA': 'Cisco', '00:6A:F2': 'Cisco',
        '00:6B:19': 'Cisco', '00:6B:2F': 'Cisco', '00:6B:42': 'Cisco', '00:6B:5B': 'Cisco',
        '00:6B:8E': 'Cisco', '00:6B:BD': 'Cisco', '00:6B:DA': 'Cisco', '00:6B:F2': 'Cisco',
        '00:6C:19': 'Cisco', '00:6C:2F': 'Cisco', '00:6C:42': 'Cisco', '00:6C:5B': 'Cisco',
        '00:6C:8E': 'Cisco', '00:6C:BD': 'Cisco', '00:6C:DA': 'Cisco', '00:6C:F2': 'Cisco',
        '00:6D:19': 'Cisco', '00:6D:2F': 'Cisco', '00:6D:42': 'Cisco', '00:6D:5B': 'Cisco',
        '00:6D:8E': 'Cisco', '00:6D:BD': 'Cisco', '00:6D:DA': 'Cisco', '00:6D:F2': 'Cisco',
        '00:6E:19': 'Cisco', '00:6E:2F': 'Cisco', '00:6E:42': 'Cisco', '00:6E:5B': 'Cisco',
        '00:6E:8E': 'Cisco', '00:6E:BD': 'Cisco', '00:6E:DA': 'Cisco', '00:6E:F2': 'Cisco',
        '00:6F:19': 'Cisco', '00:6F:2F': 'Cisco', '00:6F:42': 'Cisco', '00:6F:5B': 'Cisco',
        '00:6F:8E': 'Cisco', '00:6F:BD': 'Cisco', '00:6F:DA': 'Cisco', '00:6F:F2': 'Cisco',
        '00:70:19': 'Cisco', '00:70:2F': 'Cisco', '00:70:42': 'Cisco', '00:70:5B': 'Cisco',
        '00:70:8E': 'Cisco', '00:70:BD': 'Cisco', '00:70:DA': 'Cisco', '00:70:F2': 'Cisco',
        '00:71:19': 'Cisco', '00:71:2F': 'Cisco', '00:71:42': 'Cisco', '00:71:5B': 'Cisco',
        '00:71:8E': 'Cisco', '00:71:BD': 'Cisco', '00:71:DA': 'Cisco', '00:71:F2': 'Cisco',
        '00:72:19': 'Cisco', '00:72:2F': 'Cisco', '00:72:42': 'Cisco', '00:72:5B': 'Cisco',
        '00:72:8E': 'Cisco', '00:72:BD': 'Cisco', '00:72:DA': 'Cisco', '00:72:F2': 'Cisco',
        '00:73:19': 'Cisco', '00:73:2F': 'Cisco', '00:73:42': 'Cisco', '00:73:5B': 'Cisco',
        '00:73:8E': 'Cisco', '00:73:BD': 'Cisco', '00:73:DA': 'Cisco', '00:73:F2': 'Cisco',
        '00:74:19': 'Cisco', '00:74:2F': 'Cisco', '00:74:42': 'Cisco', '00:74:5B': 'Cisco',
        '00:74:8E': 'Cisco', '00:74:BD': 'Cisco', '00:74:DA': 'Cisco', '00:74:F2': 'Cisco',
        '00:75:19': 'Cisco', '00:75:2F': 'Cisco', '00:75:42': 'Cisco', '00:75:5B': 'Cisco',
        '00:75:8E': 'Cisco', '00:75:BD': 'Cisco', '00:75:DA': 'Cisco', '00:75:F2': 'Cisco',
        '00:76:19': 'Cisco', '00:76:2F': 'Cisco', '00:76:42': 'Cisco', '00:76:5B': 'Cisco',
        '00:76:8E': 'Cisco', '00:76:BD': 'Cisco', '00:76:DA': 'Cisco', '00:76:F2': 'Cisco',
        '00:77:19': 'Cisco', '00:77:2F': 'Cisco', '00:77:42': 'Cisco', '00:77:5B': 'Cisco',
        '00:77:8E': 'Cisco', '00:77:BD': 'Cisco', '00:77:DA': 'Cisco', '00:77:F2': 'Cisco',
        '00:78:19': 'Cisco', '00:78:2F': 'Cisco', '00:78:42': 'Cisco', '00:78:5B': 'Cisco',
        '00:78:8E': 'Cisco', '00:78:BD': 'Cisco', '00:78:DA': 'Cisco', '00:78:F2': 'Cisco',
        '00:79:19': 'Cisco', '00:79:2F': 'Cisco', '00:79:42': 'Cisco', '00:79:5B': 'Cisco',
        '00:79:8E': 'Cisco', '00:79:BD': 'Cisco', '00:79:DA': 'Cisco', '00:79:F2': 'Cisco',
        '00:7A:19': 'Cisco', '00:7A:2F': 'Cisco', '00:7A:42': 'Cisco', '00:7A:5B': 'Cisco',
        '00:7A:8E': 'Cisco', '00:7A:BD': 'Cisco', '00:7A:DA': 'Cisco', '00:7A:F2': 'Cisco',
        '00:7B:19': 'Cisco', '00:7B:2F': 'Cisco', '00:7B:42': 'Cisco', '00:7B:5B': 'Cisco',
        '00:7B:8E': 'Cisco', '00:7B:BD': 'Cisco', '00:7B:DA': 'Cisco', '00:7B:F2': 'Cisco',
        '00:7C:19': 'Cisco', '00:7C:2F': 'Cisco', '00:7C:42': 'Cisco', '00:7C:5B': 'Cisco',
        '00:7C:8E': 'Cisco', '00:7C:BD': 'Cisco', '00:7C:DA': 'Cisco', '00:7C:F2': 'Cisco',
        '00:7D:19': 'Cisco', '00:7D:2F': 'Cisco', '00:7D:42': 'Cisco', '00:7D:5B': 'Cisco',
        '00:7D:8E': 'Cisco', '00:7D:BD': 'Cisco', '00:7D:DA': 'Cisco', '00:7D:F2': 'Cisco',
        '00:7E:19': 'Cisco', '00:7E:2F': 'Cisco', '00:7E:42': 'Cisco', '00:7E:5B': 'Cisco',
        '00:7E:8E': 'Cisco', '00:7E:BD': 'Cisco', '00:7E:DA': 'Cisco', '00:7E:F2': 'Cisco',
        '00:7F:19': 'Cisco', '00:7F:2F': 'Cisco', '00:7F:42': 'Cisco', '00:7F:5B': 'Cisco',
        '00:7F:8E': 'Cisco', '00:7F:BD': 'Cisco', '00:7F:DA': 'Cisco', '00:7F:F2': 'Cisco',
        '00:80:19': 'Cisco', '00:80:2F': 'Cisco', '00:80:42': 'Cisco', '00:80:5B': 'Cisco',
        '00:80:8E': 'Cisco', '00:80:BD': 'Cisco', '00:80:DA': 'Cisco', '00:80:F2': 'Cisco',
        '00:81:19': 'Cisco', '00:81:2F': 'Cisco', '00:81:42': 'Cisco', '00:81:5B': 'Cisco',
        '00:81:8E': 'Cisco', '00:81:BD': 'Cisco', '00:81:DA': 'Cisco', '00:81:F2': 'Cisco',
        '00:82:19': 'Cisco', '00:82:2F': 'Cisco', '00:82:42': 'Cisco', '00:82:5B': 'Cisco',
        '00:82:8E': 'Cisco', '00:82:BD': 'Cisco', '00:82:DA': 'Cisco', '00:82:F2': 'Cisco',
        '00:83:19': 'Cisco', '00:83:2F': 'Cisco', '00:83:42': 'Cisco', '00:83:5B': 'Cisco',
        '00:83:8E': 'Cisco', '00:83:BD': 'Cisco', '00:83:DA': 'Cisco', '00:83:F2': 'Cisco',
        '00:84:19': 'Cisco', '00:84:2F': 'Cisco', '00:84:42': 'Cisco', '00:84:5B': 'Cisco',
        '00:84:8E': 'Cisco', '00:84:BD': 'Cisco', '00:84:DA': 'Cisco', '00:84:F2': 'Cisco',
        '00:85:19': 'Cisco', '00:85:2F': 'Cisco', '00:85:42': 'Cisco', '00:85:5B': 'Cisco',
        '00:85:8E': 'Cisco', '00:85:BD': 'Cisco', '00:85:DA': 'Cisco', '00:85:F2': 'Cisco',
        '00:86:19': 'Cisco', '00:86:2F': 'Cisco', '00:86:42': 'Cisco', '00:86:5B': 'Cisco',
        '00:86:8E': 'Cisco', '00:86:BD': 'Cisco', '00:86:DA': 'Cisco', '00:86:F2': 'Cisco',
        '00:87:19': 'Cisco', '00:87:2F': 'Cisco', '00:87:42': 'Cisco', '00:87:5B': 'Cisco',
        '00:87:8E': 'Cisco', '00:87:BD': 'Cisco', '00:87:DA': 'Cisco', '00:87:F2': 'Cisco',
        '00:88:19': 'Cisco', '00:88:2F': 'Cisco', '00:88:42': 'Cisco', '00:88:5B': 'Cisco',
        '00:88:8E': 'Cisco', '00:88:BD': 'Cisco', '00:88:DA': 'Cisco', '00:88:F2': 'Cisco',
        '00:89:19': 'Cisco', '00:89:2F': 'Cisco', '00:89:42': 'Cisco', '00:89:5B': 'Cisco',
        '00:89:8E': 'Cisco', '00:89:BD': 'Cisco', '00:89:DA': 'Cisco', '00:89:F2': 'Cisco',
        '00:8A:19': 'Cisco', '00:8A:2F': 'Cisco', '00:8A:42': 'Cisco', '00:8A:5B': 'Cisco',
        '00:8A:8E': 'Cisco', '00:8A:BD': 'Cisco', '00:8A:DA': 'Cisco', '00:8A:F2': 'Cisco',
        '00:8B:19': 'Cisco', '00:8B:2F': 'Cisco', '00:8B:42': 'Cisco', '00:8B:5B': 'Cisco',
        '00:8B:8E': 'Cisco', '00:8B:BD': 'Cisco', '00:8B:DA': 'Cisco', '00:8B:F2': 'Cisco',
        '00:8C:19': 'Cisco', '00:8C:2F': 'Cisco', '00:8C:42': 'Cisco', '00:8C:5B': 'Cisco',
        '00:8C:8E': 'Cisco', '00:8C:BD': 'Cisco', '00:8C:DA': 'Cisco', '00:8C:F2': 'Cisco',
        '00:8D:19': 'Cisco', '00:8D:2F': 'Cisco', '00:8D:42': 'Cisco', '00:8D:5B': 'Cisco',
        '00:8D:8E': 'Cisco', '00:8D:BD': 'Cisco', '00:8D:DA': 'Cisco', '00:8D:F2': 'Cisco',
        '00:8E:19': 'Cisco', '00:8E:2F': 'Cisco', '00:8E:42': 'Cisco', '00:8E:5B': 'Cisco',
        '00:8E:8E': 'Cisco', '00:8E:BD': 'Cisco', '00:8E:DA': 'Cisco', '00:8E:F2': 'Cisco',
        '00:8F:19': 'Cisco', '00:8F:2F': 'Cisco', '00:8F:42': 'Cisco', '00:8F:5B': 'Cisco',
        '00:8F:8E': 'Cisco', '00:8F:BD': 'Cisco', '00:8F:DA': 'Cisco', '00:8F:F2': 'Cisco',
        '00:90:19': 'Cisco', '00:90:2F': 'Cisco', '00:90:42': 'Cisco', '00:90:5B': 'Cisco',
        '00:90:8E': 'Cisco', '00:90:BD': 'Cisco', '00:90:DA': 'Cisco', '00:90:F2': 'Cisco',
        '00:91:19': 'Cisco', '00:91:2F': 'Cisco', '00:91:42': 'Cisco', '00:91:5B': 'Cisco',
        '00:91:8E': 'Cisco', '00:91:BD': 'Cisco', '00:91:DA': 'Cisco', '00:91:F2': 'Cisco',
        '00:92:19': 'Cisco', '00:92:2F': 'Cisco', '00:92:42': 'Cisco', '00:92:5B': 'Cisco',
        '00:92:8E': 'Cisco', '00:92:BD': 'Cisco', '00:92:DA': 'Cisco', '00:92:F2': 'Cisco',
        '00:93:19': 'Cisco', '00:93:2F': 'Cisco', '00:93:42': 'Cisco', '00:93:5B': 'Cisco',
        '00:93:8E': 'Cisco', '00:93:BD': 'Cisco', '00:93:DA': 'Cisco', '00:93:F2': 'Cisco',
        '00:94:19': 'Cisco', '00:94:2F': 'Cisco', '00:94:42': 'Cisco', '00:94:5B': 'Cisco',
        '00:94:8E': 'Cisco', '00:94:BD': 'Cisco', '00:94:DA': 'Cisco', '00:94:F2': 'Cisco',
        '00:95:19': 'Cisco', '00:95:2F': 'Cisco', '00:95:42': 'Cisco', '00:95:5B': 'Cisco',
        '00:95:8E': 'Cisco', '00:95:BD': 'Cisco', '00:95:DA': 'Cisco', '00:95:F2': 'Cisco',
        '00:96:19': 'Cisco', '00:96:2F': 'Cisco', '00:96:42': 'Cisco', '00:96:5B': 'Cisco',
        '00:96:8E': 'Cisco', '00:96:BD': 'Cisco', '00:96:DA': 'Cisco', '00:96:F2': 'Cisco',
        '00:97:19': 'Cisco', '00:97:2F': 'Cisco', '00:97:42': 'Cisco', '00:97:5B': 'Cisco',
        '00:97:8E': 'Cisco', '00:97:BD': 'Cisco', '00:97:DA': 'Cisco', '00:97:F2': 'Cisco',
        '00:98:19': 'Cisco', '00:98:2F': 'Cisco', '00:98:42': 'Cisco', '00:98:5B': 'Cisco',
        '00:98:8E': 'Cisco', '00:98:BD': 'Cisco', '00:98:DA': 'Cisco', '00:98:F2': 'Cisco',
        '00:99:19': 'Cisco', '00:99:2F': 'Cisco', '00:99:42': 'Cisco', '00:99:5B': 'Cisco',
        '00:99:8E': 'Cisco', '00:99:BD': 'Cisco', '00:99:DA': 'Cisco', '00:99:F2': 'Cisco',
        '00:9A:19': 'Cisco', '00:9A:2F': 'Cisco', '00:9A:42': 'Cisco', '00:9A:5B': 'Cisco',
        '00:9A:8E': 'Cisco', '00:9A:BD': 'Cisco', '00:9A:DA': 'Cisco', '00:9A:F2': 'Cisco',
        '00:9B:19': 'Cisco', '00:9B:2F': 'Cisco', '00:9B:42': 'Cisco', '00:9B:5B': 'Cisco',
        '00:9B:8E': 'Cisco', '00:9B:BD': 'Cisco', '00:9B:DA': 'Cisco', '00:9B:F2': 'Cisco',
        '00:9C:19': 'Cisco', '00:9C:2F': 'Cisco', '00:9C:42': 'Cisco', '00:9C:5B': 'Cisco',
        '00:9C:8E': 'Cisco', '00:9C:BD': 'Cisco', '00:9C:DA': 'Cisco', '00:9C:F2': 'Cisco',
        '00:9D:19': 'Cisco', '00:9D:2F': 'Cisco', '00:9D:42': 'Cisco', '00:9D:5B': 'Cisco',
        '00:9D:8E': 'Cisco', '00:9D:BD': 'Cisco', '00:9D:DA': 'Cisco', '00:9D:F2': 'Cisco',
        '00:9E:19': 'Cisco', '00:9E:2F': 'Cisco', '00:9E:42': 'Cisco', '00:9E:5B': 'Cisco',
        '00:9E:8E': 'Cisco', '00:9E:BD': 'Cisco', '00:9E:DA': 'Cisco', '00:9E:F2': 'Cisco',
        '00:9F:19': 'Cisco', '00:9F:2F': 'Cisco', '00:9F:42': 'Cisco', '00:9F:5B': 'Cisco',
        '00:9F:8E': 'Cisco', '00:9F:BD': 'Cisco', '00:9F:DA': 'Cisco', '00:9F:F2': 'Cisco',
        '00:A0:19': 'Cisco', '00:A0:2F': 'Cisco', '00:A0:42': 'Cisco', '00:A0:5B': 'Cisco',
        '00:A0:8E': 'Cisco', '00:A0:BD': 'Cisco', '00:A0:DA': 'Cisco', '00:A0:F2': 'Cisco',
        '00:A1:19': 'Cisco', '00:A1:2F': 'Cisco', '00:A1:42': 'Cisco', '00:A1:5B': 'Cisco',
        '00:A1:8E': 'Cisco', '00:A1:BD': 'Cisco', '00:A1:DA': 'Cisco', '00:A1:F2': 'Cisco',
        '00:A2:19': 'Cisco', '00:A2:2F': 'Cisco', '00:A2:42': 'Cisco', '00:A2:5B': 'Cisco',
        '00:A2:8E': 'Cisco', '00:A2:BD': 'Cisco', '00:A2:DA': 'Cisco', '00:A2:F2': 'Cisco',
        '00:A3:19': 'Cisco', '00:A3:2F': 'Cisco', '00:A3:42': 'Cisco', '00:A3:5B': 'Cisco',
        '00:A3:8E': 'Cisco', '00:A3:BD': 'Cisco', '00:A3:DA': 'Cisco', '00:A3:F2': 'Cisco',
        '00:A4:19': 'Cisco', '00:A4:2F': 'Cisco', '00:A4:42': 'Cisco', '00:A4:5B': 'Cisco',
        '00:A4:8E': 'Cisco', '00:A4:BD': 'Cisco', '00:A4:DA': 'Cisco', '00:A4:F2': 'Cisco',
        '00:A5:19': 'Cisco', '00:A5:2F': 'Cisco', '00:A5:42': 'Cisco', '00:A5:5B': 'Cisco',
        '00:A5:8E': 'Cisco', '00:A5:BD': 'Cisco', '00:A5:DA': 'Cisco', '00:A5:F2': 'Cisco',
        '00:A6:19': 'Cisco', '00:A6:2F': 'Cisco', '00:A6:42': 'Cisco', '00:A6:5B': 'Cisco',
        '00:A6:8E': 'Cisco', '00:A6:BD': 'Cisco', '00:A6:DA': 'Cisco', '00:A6:F2': 'Cisco',
        '00:A7:19': 'Cisco', '00:A7:2F': 'Cisco', '00:A7:42': 'Cisco', '00:A7:5B': 'Cisco',
        '00:A7:8E': 'Cisco', '00:A7:BD': 'Cisco', '00:A7:DA': 'Cisco', '00:A7:F2': 'Cisco',
        '00:A8:19': 'Cisco', '00:A8:2F': 'Cisco', '00:A8:42': 'Cisco', '00:A8:5B': 'Cisco',
        '00:A8:8E': 'Cisco', '00:A8:BD': 'Cisco', '00:A8:DA': 'Cisco', '00:A8:F2': 'Cisco',
        '00:A9:19': 'Cisco', '00:A9:2F': 'Cisco', '00:A9:42': 'Cisco', '00:A9:5B': 'Cisco',
        '00:A9:8E': 'Cisco', '00:A9:BD': 'Cisco', '00:A9:DA': 'Cisco', '00:A9:F2': 'Cisco',
        '00:AA:19': 'Cisco', '00:AA:2F': 'Cisco', '00:AA:42': 'Cisco', '00:AA:5B': 'Cisco',
        '00:AA:8E': 'Cisco', '00:AA:BD': 'Cisco', '00:AA:DA': 'Cisco', '00:AA:F2': 'Cisco',
        '00:AB:19': 'Cisco', '00:AB:2F': 'Cisco', '00:AB:42': 'Cisco', '00:AB:5B': 'Cisco',
        '00:AB:8E': 'Cisco', '00:AB:BD': 'Cisco', '00:AB:DA': 'Cisco', '00:AB:F2': 'Cisco',
        '00:AC:19': 'Cisco', '00:AC:2F': 'Cisco', '00:AC:42': 'Cisco', '00:AC:5B': 'Cisco',
        '00:AC:8E': 'Cisco', '00:AC:BD': 'Cisco', '00:AC:DA': 'Cisco', '00:AC:F2': 'Cisco',
        '00:AD:19': 'Cisco', '00:AD:2F': 'Cisco', '00:AD:42': 'Cisco', '00:AD:5B': 'Cisco',
        '00:AD:8E': 'Cisco', '00:AD:BD': 'Cisco', '00:AD:DA': 'Cisco', '00:AD:F2': 'Cisco',
        '00:AE:19': 'Cisco', '00:AE:2F': 'Cisco', '00:AE:42': 'Cisco', '00:AE:5B': 'Cisco',
        '00:AE:8E': 'Cisco', '00:AE:BD': 'Cisco', '00:AE:DA': 'Cisco', '00:AE:F2': 'Cisco',
        '00:AF:19': 'Cisco', '00:AF:2F': 'Cisco', '00:AF:42': 'Cisco', '00:AF:5B': 'Cisco',
        '00:AF:8E': 'Cisco', '00:AF:BD': 'Cisco', '00:AF:DA': 'Cisco', '00:AF:F2': 'Cisco',
        '00:B0:19': 'Cisco', '00:B0:2F': 'Cisco', '00:B0:42': 'Cisco', '00:B0:5B': 'Cisco',
        '00:B0:8E': 'Cisco', '00:B0:BD': 'Cisco', '00:B0:DA': 'Cisco', '00:B0:F2': 'Cisco',
        '00:B1:19': 'Cisco', '00:B1:2F': 'Cisco', '00:B1:42': 'Cisco', '00:B1:5B': 'Cisco',
        '00:B1:8E': 'Cisco', '00:B1:BD': 'Cisco', '00:B1:DA': 'Cisco', '00:B1:F2': 'Cisco',
        '00:B2:19': 'Cisco', '00:B2:2F': 'Cisco', '00:B2:42': 'Cisco', '00:B2:5B': 'Cisco',
        '00:B2:8E': 'Cisco', '00:B2:BD': 'Cisco', '00:B2:DA': 'Cisco', '00:B2:F2': 'Cisco',
        '00:B3:19': 'Cisco', '00:B3:2F': 'Cisco', '00:B3:42': 'Cisco', '00:B3:5B': 'Cisco',
        '00:B3:8E': 'Cisco', '00:B3:BD': 'Cisco', '00:B3:DA': 'Cisco', '00:B3:F2': 'Cisco',
        '00:B4:19': 'Cisco', '00:B4:2F': 'Cisco', '00:B4:42': 'Cisco', '00:B4:5B': 'Cisco',
        '00:B4:8E': 'Cisco', '00:B4:BD': 'Cisco', '00:B4:DA': 'Cisco', '00:B4:F2': 'Cisco',
        '00:B5:19': 'Cisco', '00:B5:2F': 'Cisco', '00:B5:42': 'Cisco', '00:B5:5B': 'Cisco',
        '00:B5:8E': 'Cisco', '00:B5:BD': 'Cisco', '00:B5:DA': 'Cisco', '00:B5:F2': 'Cisco',
        '00:B6:19': 'Cisco', '00:B6:2F': 'Cisco', '00:B6:42': 'Cisco', '00:B6:5B': 'Cisco',
        '00:B6:8E': 'Cisco', '00:B6:BD': 'Cisco', '00:B6:DA': 'Cisco', '00:B6:F2': 'Cisco',
        '00:B7:19': 'Cisco', '00:B7:2F': 'Cisco', '00:B7:42': 'Cisco', '00:B7:5B': 'Cisco',
        '00:B7:8E': 'Cisco', '00:B7:BD': 'Cisco', '00:B7:DA': 'Cisco', '00:B7:F2': 'Cisco',
        '00:B8:19': 'Cisco', '00:B8:2F': 'Cisco', '00:B8:42': 'Cisco', '00:B8:5B': 'Cisco',
        '00:B8:8E': 'Cisco', '00:B8:BD': 'Cisco', '00:B8:DA': 'Cisco', '00:B8:F2': 'Cisco',
        '00:B9:19': 'Cisco', '00:B9:2F': 'Cisco', '00:B9:42': 'Cisco', '00:B9:5B': 'Cisco',
        '00:B9:8E': 'Cisco', '00:B9:BD': 'Cisco', '00:B9:DA': 'Cisco', '00:B9:F2': 'Cisco',
        '00:BA:19': 'Cisco', '00:BA:2F': 'Cisco', '00:BA:42': 'Cisco', '00:BA:5B': 'Cisco',
        '00:BA:8E': 'Cisco', '00:BA:BD': 'Cisco', '00:BA:DA': 'Cisco', '00:BA:F2': 'Cisco',
        '00:BB:19': 'Cisco', '00:BB:2F': 'Cisco', '00:BB:42': 'Cisco', '00:BB:5B': 'Cisco',
        '00:BB:8E': 'Cisco', '00:BB:BD': 'Cisco', '00:BB:DA': 'Cisco', '00:BB:F2': 'Cisco',
        '00:BC:19': 'Cisco', '00:BC:2F': 'Cisco', '00:BC:42': 'Cisco', '00:BC:5B': 'Cisco',
        '00:BC:8E': 'Cisco', '00:BC:BD': 'Cisco', '00:BC:DA': 'Cisco', '00:BC:F2': 'Cisco',
        '00:BD:19': 'Cisco', '00:BD:2F': 'Cisco', '00:BD:42': 'Cisco', '00:BD:5B': 'Cisco',
        '00:BD:8E': 'Cisco', '00:BD:BD': 'Cisco', '00:BD:DA': 'Cisco', '00:BD:F2': 'Cisco',
        '00:BE:19': 'Cisco', '00:BE:2F': 'Cisco', '00:BE:42': 'Cisco', '00:BE:5B': 'Cisco',
        '00:BE:8E': 'Cisco', '00:BE:BD': 'Cisco', '00:BE:DA': 'Cisco', '00:BE:F2': 'Cisco',
        '00:BF:19': 'Cisco', '00:BF:2F': 'Cisco', '00:BF:42': 'Cisco', '00:BF:5B': 'Cisco',
        '00:BF:8E': 'Cisco', '00:BF:BD': 'Cisco', '00:BF:DA': 'Cisco', '00:BF:F2': 'Cisco',
        '00:C0:19': 'Cisco', '00:C0:2F': 'Cisco', '00:C0:42': 'Cisco', '00:C0:5B': 'Cisco',
        '00:C0:8E': 'Cisco', '00:C0:BD': 'Cisco', '00:C0:DA': 'Cisco', '00:C0:F2': 'Cisco',
        '00:C1:19': 'Cisco', '00:C1:2F': 'Cisco', '00:C1:42': 'Cisco', '00:C1:5B': 'Cisco',
        '00:C1:8E': 'Cisco', '00:C1:BD': 'Cisco', '00:C1:DA': 'Cisco', '00:C1:F2': 'Cisco',
        '00:C2:19': 'Cisco', '00:C2:2F': 'Cisco', '00:C2:42': 'Cisco', '00:C2:5B': 'Cisco',
        '00:C2:8E': 'Cisco', '00:C2:BD': 'Cisco', '00:C2:DA': 'Cisco', '00:C2:F2': 'Cisco',
        '00:C3:19': 'Cisco', '00:C3:2F': 'Cisco', '00:C3:42': 'Cisco', '00:C3:5B': 'Cisco',
        '00:C3:8E': 'Cisco', '00:C3:BD': 'Cisco', '00:C3:DA': 'Cisco', '00:C3:F2': 'Cisco',
        '00:C4:19': 'Cisco', '00:C4:2F': 'Cisco', '00:C4:42': 'Cisco', '00:C4:5B': 'Cisco',
        '00:C4:8E': 'Cisco', '00:C4:BD': 'Cisco', '00:C4:DA': 'Cisco', '00:C4:F2': 'Cisco',
        '00:C5:19': 'Cisco', '00:C5:2F': 'Cisco', '00:C5:42': 'Cisco', '00:C5:5B': 'Cisco',
        '00:C5:8E': 'Cisco', '00:C5:BD': 'Cisco', '00:C5:DA': 'Cisco', '00:C5:F2': 'Cisco',
        '00:C6:19': 'Cisco', '00:C6:2F': 'Cisco', '00:C6:42': 'Cisco', '00:C6:5B': 'Cisco',
        '00:C6:8E': 'Cisco', '00:C6:BD': 'Cisco', '00:C6:DA': 'Cisco', '00:C6:F2': 'Cisco',
        '00:C7:19': 'Cisco', '00:C7:2F': 'Cisco', '00:C7:42': 'Cisco', '00:C7:5B': 'Cisco',
        '00:C7:8E': 'Cisco', '00:C7:BD': 'Cisco', '00:C7:DA': 'Cisco', '00:C7:F2': 'Cisco',
        '00:C8:19': 'Cisco', '00:C8:2F': 'Cisco', '00:C8:42': 'Cisco', '00:C8:5B': 'Cisco',
        '00:C8:8E': 'Cisco', '00:C8:BD': 'Cisco', '00:C8:DA': 'Cisco', '00:C8:F2': 'Cisco',
        '00:C9:19': 'Cisco', '00:C9:2F': 'Cisco', '00:C9:42': 'Cisco', '00:C9:5B': 'Cisco',
        '00:C9:8E': 'Cisco', '00:C9:BD': 'Cisco', '00:C9:DA': 'Cisco', '00:C9:F2': 'Cisco',
        '00:CA:19': 'Cisco', '00:CA:2F': 'Cisco', '00:CA:42': 'Cisco', '00:CA:5B': 'Cisco',
        '00:CA:8E': 'Cisco', '00:CA:BD': 'Cisco', '00:CA:DA': 'Cisco', '00:CA:F2': 'Cisco',
        '00:CB:19': 'Cisco', '00:CB:2F': 'Cisco', '00:CB:42': 'Cisco', '00:CB:5B': 'Cisco',
        '00:CB:8E': 'Cisco', '00:CB:BD': 'Cisco', '00:CB:DA': 'Cisco', '00:CB:F2': 'Cisco',
        '00:CC:19': 'Cisco', '00:CC:2F': 'Cisco', '00:CC:42': 'Cisco', '00:CC:5B': 'Cisco',
        '00:CC:8E': 'Cisco', '00:CC:BD': 'Cisco', '00:CC:DA': 'Cisco', '00:CC:F2': 'Cisco',
        '00:CD:19': 'Cisco', '00:CD:2F': 'Cisco', '00:CD:42': 'Cisco', '00:CD:5B': 'Cisco',
        '00:CD:8E': 'Cisco', '00:CD:BD': 'Cisco', '00:CD:DA': 'Cisco', '00:CD:F2': 'Cisco',
        '00:CE:19': 'Cisco', '00:CE:2F': 'Cisco', '00:CE:42': 'Cisco', '00:CE:5B': 'Cisco',
        '00:CE:8E': 'Cisco', '00:CE:BD': 'Cisco', '00:CE:DA': 'Cisco', '00:CE:F2': 'Cisco',
        '00:CF:19': 'Cisco', '00:CF:2F': 'Cisco', '00:CF:42': 'Cisco', '00:CF:5B': 'Cisco',
        '00:CF:8E': 'Cisco', '00:CF:BD': 'Cisco', '00:CF:DA': 'Cisco', '00:CF:F2': 'Cisco',
        '00:D0:19': 'Cisco', '00:D0:2F': 'Cisco', '00:D0:42': 'Cisco', '00:D0:5B': 'Cisco',
        '00:D0:8E': 'Cisco', '00:D0:BD': 'Cisco', '00:D0:DA': 'Cisco', '00:D0:F2': 'Cisco',
        '00:D1:19': 'Cisco', '00:D1:2F': 'Cisco', '00:D1:42': 'Cisco', '00:D1:5B': 'Cisco',
        '00:D1:8E': 'Cisco', '00:D1:BD': 'Cisco', '00:D1:DA': 'Cisco', '00:D1:F2': 'Cisco',
        '00:D2:19': 'Cisco', '00:D2:2F': 'Cisco', '00:D2:42': 'Cisco', '00:D2:5B': 'Cisco',
        '00:D2:8E': 'Cisco', '00:D2:BD': 'Cisco', '00:D2:DA': 'Cisco', '00:D2:F2': 'Cisco',
        '00:D3:19': 'Cisco', '00:D3:2F': 'Cisco', '00:D3:42': 'Cisco', '00:D3:5B': 'Cisco',
        '00:D3:8E': 'Cisco', '00:D3:BD': 'Cisco', '00:D3:DA': 'Cisco', '00:D3:F2': 'Cisco',
        '00:D4:19': 'Cisco', '00:D4:2F': 'Cisco', '00:D4:42': 'Cisco', '00:D4:5B': 'Cisco',
        '00:D4:8E': 'Cisco', '00:D4:BD': 'Cisco', '00:D4:DA': 'Cisco', '00:D4:F2': 'Cisco',
        '00:D5:19': 'Cisco', '00:D5:2F': 'Cisco', '00:D5:42': 'Cisco', '00:D5:5B': 'Cisco',
        '00:D5:8E': 'Cisco', '00:D5:BD': 'Cisco', '00:D5:DA': 'Cisco', '00:D5:F2': 'Cisco',
        '00:D6:19': 'Cisco', '00:D6:2F': 'Cisco', '00:D6:42': 'Cisco', '00:D6:5B': 'Cisco',
        '00:D6:8E': 'Cisco', '00:D6:BD': 'Cisco', '00:D6:DA': 'Cisco', '00:D6:F2': 'Cisco',
        '00:D7:19': 'Cisco', '00:D7:2F': 'Cisco', '00:D7:42': 'Cisco', '00:D7:5B': 'Cisco',
        '00:D7:8E': 'Cisco', '00:D7:BD': 'Cisco', '00:D7:DA': 'Cisco', '00:D7:F2': 'Cisco',
        '00:D8:19': 'Cisco', '00:D8:2F': 'Cisco', '00:D8:42': 'Cisco', '00:D8:5B': 'Cisco',
        '00:D8:8E': 'Cisco', '00:D8:BD': 'Cisco', '00:D8:DA': 'Cisco', '00:D8:F2': 'Cisco',
        '00:D9:19': 'Cisco', '00:D9:2F': 'Cisco', '00:D9:42': 'Cisco', '00:D9:5B': 'Cisco',
        '00:D9:8E': 'Cisco', '00:D9:BD': 'Cisco', '00:D9:DA': 'Cisco', '00:D9:F2': 'Cisco',
        '00:DA:19': 'Cisco', 'Cisco', '00:DA:42': 'Cisco', '00:DA:5B': 'Cisco',
        '00:DA:8E': 'Cisco', '00:DA:BD': 'Cisco', '00:DA:DA': 'Cisco', '00:DA:F2': 'Cisco',
        '00:DB:19': 'Cisco', '00:DB:2F': 'Cisco', '00:DB:42': 'Cisco', '00:DB:5B': 'Cisco',
        '00:DB:8E': 'Cisco', '00:DB:BD': 'Cisco', '00:DB:DA': 'Cisco', '00:DB:F2': 'Cisco',
        '00:DC:19': 'Cisco', '00:DC:2F': 'Cisco', '00:DC:42': 'Cisco', '00:DC:5B': 'Cisco',
        '00:DC:8E': 'Cisco', '00:DC:BD': 'Cisco', '00:DC:DA': 'Cisco', '00:DC:F2': 'Cisco',
        '00:DD:19': 'Cisco', '00:DD:2F': 'Cisco', '00:DD:42': 'Cisco', '00:DD:5B': 'Cisco',
        '00:DD:8E': 'Cisco', '00:DD:BD': 'Cisco', '00:DD:DA': 'Cisco', '00:DD:F2': 'Cisco',
        '00:DE:19': 'Cisco', '00:DE:2F': 'Cisco', '00:DE:42': 'Cisco', '00:DE:5B': 'Cisco',
        '00:DE:8E': 'Cisco', '00:DE:BD': 'Cisco', '00:DE:DA': 'Cisco', '00:DE:F2': 'Cisco',
        '00:DF:19': 'Cisco', '00:DF:2F': 'Cisco', '00:DF:42': 'Cisco', '00:DF:5B': 'Cisco',
        '00:DF:8E': 'Cisco', '00:DF:BD': 'Cisco', '00:DF:DA': 'Cisco', '00:DF:F2': 'Cisco',
        '00:E0:19': 'Cisco', '00:E0:2F': 'Cisco', '00:E0:42': 'Cisco', '00:E0:5B': 'Cisco',
        '00:E0:8E': 'Cisco', '00:E0:BD': 'Cisco', '00:E0:DA': 'Cisco', '00:E0:F2': 'Cisco',
        '00:E1:19': 'Cisco', '00:E1:2F': 'Cisco', '00:E1:42': 'Cisco', '00:E1:5B': 'Cisco',
        '00:E1:8E': 'Cisco', '00:E1:BD': 'Cisco', '00:E1:DA': 'Cisco', '00:E1:F2': 'Cisco',
        '00:E2:19': 'Cisco', '00:E2:2F': 'Cisco', '00:E2:42': 'Cisco', '00:E2:5B': 'Cisco',
        '00:E2:8E': 'Cisco', '00:E2:BD': 'Cisco', '00:E2:DA': 'Cisco', '00:E2:F2': 'Cisco',
        '00:E3:19': 'Cisco', '00:E3:2F': 'Cisco', '00:E3:42': 'Cisco', '00:E3:5B': 'Cisco',
        '00:E3:8E': 'Cisco', '00:E3:BD': 'Cisco', '00:E3:DA': 'Cisco', '00:E3:F2': 'Cisco',
        '00:E4:19': 'Cisco', '00:E4:2F': 'Cisco', '00:E4:42': 'Cisco', '00:E4:5B': 'Cisco',
        '00:E4:8E': 'Cisco', '00:E4:BD': 'Cisco', '00:E4:DA': 'Cisco', '00:E4:F2': 'Cisco',
        '00:E5:19': 'Cisco', '00:E5:2F': 'Cisco', '00:E5:42': 'Cisco', '00:E5:5B': 'Cisco',
        '00:E5:8E': 'Cisco', '00:E5:BD': 'Cisco', '00:E5:DA': 'Cisco', '00:E5:F2': 'Cisco',
        '00:E6:19': 'Cisco', '00:E6:2F': 'Cisco', '00:E6:42': 'Cisco', '00:E6:5B': 'Cisco',
        '00:E6:8E': 'Cisco', '00:E6:BD': 'Cisco', '00:E6:DA': 'Cisco', '00:E6:F2': 'Cisco',
        '00:E7:19': 'Cisco', '00:E7:2F': 'Cisco', '00:E7:42': 'Cisco', '00:E7:5B': 'Cisco',
        '00:E7:8E': 'Cisco', '00:E7:BD': 'Cisco', '00:E7:DA': 'Cisco', '00:E7:F2': 'Cisco',
        '00:E8:19': 'Cisco', '00:E8:2F': 'Cisco', '00:E8:42': 'Cisco', '00:E8:5B': 'Cisco',
        '00:E8:8E': 'Cisco', '00:E8:BD': 'Cisco', '00:E8:DA': 'Cisco', '00:E8:F2': 'Cisco',
        '00:E9:19': 'Cisco', '00:E9:2F': 'Cisco', '00:E9:42': 'Cisco', '00:E9:5B': 'Cisco',
        '00:E9:8E': 'Cisco', '00:E9:BD': 'Cisco', '00:E9:DA': 'Cisco', '00:E9:F2': 'Cisco',
        '00:EA:19': 'Cisco', '00:EA:2F': 'Cisco', '00:EA:42': 'Cisco', '00:EA:5B': 'Cisco',
        '00:EA:8E': 'Cisco', '00:EA:BD': 'Cisco', '00:EA:DA': 'Cisco', '00:EA:F2': 'Cisco',
        '00:EB:19': 'Cisco', '00:EB:2F': 'Cisco', '00:EB:42': 'Cisco', '00:EB:5B': 'Cisco',
        '00:EB:8E': 'Cisco', '00:EB:BD': 'Cisco', '00:EB:DA': 'Cisco', '00:EB:F2': 'Cisco',
        '00:EC:19': 'Cisco', '00:EC:2F': 'Cisco', '00:EC:42': 'Cisco', '00:EC:5B': 'Cisco',
        '00:EC:8E': 'Cisco', '00:EC:BD': 'Cisco', '00:EC:DA': 'Cisco', '00:EC:F2': 'Cisco',
        '00:ED:19': 'Cisco', '00:ED:2F': 'Cisco', '00:ED:42': 'Cisco', '00:ED:5B': 'Cisco',
        '00:ED:8E': 'Cisco', '00:ED:BD': 'Cisco', '00:ED:DA': 'Cisco', '00:ED:F2': 'Cisco',
        '00:EE:19': 'Cisco', '00:EE:2F': 'Cisco', '00:EE:42': 'Cisco', '00:EE:5B': 'Cisco',
        '00:EE:8E': 'Cisco', '00:EE:BD': 'Cisco', '00:EE:DA': 'Cisco', '00:EE:F2': 'Cisco',
        '00:EF:19': 'Cisco', '00:EF:2F': 'Cisco', '00:EF:42': 'Cisco', '00:EF:5B': 'Cisco',
        '00:EF:8E': 'Cisco', '00:EF:BD': 'Cisco', '00:EF:DA': 'Cisco', '00:EF:F2': 'Cisco',
        '00:F0:19': 'Cisco', '00:F0:2F': 'Cisco', '00:F0:42': 'Cisco', '00:F0:5B': 'Cisco',
        '00:F0:8E': 'Cisco', '00:F0:BD': 'Cisco', '00:F0:DA': 'Cisco', '00:F0:F2': 'Cisco',
        '00:F1:19': 'Cisco', '00:F1:2F': 'Cisco', '00:F1:42': 'Cisco', '00:F1:5B': 'Cisco',
        '00:F1:8E': 'Cisco', '00:F1:BD': 'Cisco', '00:F1:DA': 'Cisco', '00:F1:F2': 'Cisco',
        '00:F2:19': 'Cisco', '00:F2:2F': 'Cisco', '00:F2:42': 'Cisco', '00:F2:5B': 'Cisco',
        '00:F2:8E': 'Cisco', '00:F2:BD': 'Cisco', '00:F2:DA': 'Cisco', '00:F2:F2': 'Cisco',
        '00:F3:19': 'Cisco', '00:F3:2F': 'Cisco', '00:F3:42': 'Cisco', '00:F3:5B': 'Cisco',
        '00:F3:8E': 'Cisco', '00:F3:BD': 'Cisco', '00:F3:DA': 'Cisco', '00:F3:F2': 'Cisco',
        '00:F4:19': 'Cisco', '00:F4:2F': 'Cisco', '00:F4:42': 'Cisco', '00:F4:5B': 'Cisco',
        '00:F4:8E': 'Cisco', '00:F4:BD': 'Cisco', '00:F4:DA': 'Cisco', '00:F4:F2': 'Cisco',
        '00:F5:19': 'Cisco', '00:F5:2F': 'Cisco', '00:F5:42': 'Cisco', '00:F5:5B': 'Cisco',
        '00:F5:8E': 'Cisco', '00:F5:BD': 'Cisco', '00:F5:DA': 'Cisco', '00:F5:F2': 'Cisco',
        '00:F6:19': 'Cisco', '00:F6:2F': 'Cisco', '00:F6:42': 'Cisco', '00:F6:5B': 'Cisco',
        '00:F6:8E': 'Cisco', '00:F6:BD': 'Cisco', '00:F6:DA': 'Cisco', '00:F6:F2': 'Cisco',
        '00:F7:19': 'Cisco', '00:F7:2F': 'Cisco', '00:F7:42': 'Cisco', '00:F7:5B': 'Cisco',
        '00:F7:8E': 'Cisco', '00:F7:BD': 'Cisco', '00:F7:DA': 'Cisco', '00:F7:F2': 'Cisco',
        '00:F8:19': 'Cisco', '00:F8:2F': 'Cisco', '00:F8:42': 'Cisco', '00:F8:5B': 'Cisco',
        '00:F8:8E': 'Cisco', '00:F8:BD': 'Cisco', '00:F8:DA': 'Cisco', '00:F8:F2': 'Cisco',
        '00:F9:19': 'Cisco', '00:F9:2F': 'Cisco', '00:F9:42': 'Cisco', '00:F9:5B': 'Cisco',
        '00:F9:8E': 'Cisco', '00:F9:BD': 'Cisco', '00:F9:DA': 'Cisco', '00:F9:F2': 'Cisco',
        '00:FA:19': 'Cisco', '00:FA:2F': 'Cisco', '00:FA:42': 'Cisco', '00:FA:5B': 'Cisco',
        '00:FA:8E': 'Cisco', '00:FA:BD': 'Cisco', '00:FA:DA': 'Cisco', '00:FA:F2': 'Cisco',
        '00:FB:19': 'Cisco', '00:FB:2F': 'Cisco', '00:FB:42': 'Cisco', '00:FB:5B': 'Cisco',
        '00:FB:8E': 'Cisco', '00:FB:BD': 'Cisco', '00:FB:DA': 'Cisco', '00:FB:F2': 'Cisco',
        '00:FC:19': 'Cisco', '00:FC:2F': 'Cisco', '00:FC:42': 'Cisco', '00:FC:5B': 'Cisco',
        '00:FC:8E': 'Cisco', '00:FC:BD': 'Cisco', '00:FC:DA': 'Cisco', '00:FC:F2': 'Cisco',
        '00:FD:19': 'Cisco', '00:FD:2F': 'Cisco', '00:FD:42': 'Cisco', '00:FD:5B': 'Cisco',
        '00:FD:8E': 'Cisco', '00:FD:BD': 'Cisco', '00:FD:DA': 'Cisco', '00:FD:F2': 'Cisco',
        '00:FE:19': 'Cisco', '00:FE:2F': 'Cisco', '00:FE:42': 'Cisco', '00:FE:5B': 'Cisco',
        '00:FE:8E': 'Cisco', '00:FE:BD': 'Cisco', '00:FE:DA': 'Cisco', '00:FE:F2': 'Cisco',
        '00:FF:19': 'Cisco', '00:FF:2F': 'Cisco', '00:FF:42': 'Cisco', '00:FF:5B': 'Cisco',
        '00:FF:8E': 'Cisco', '00:FF:BD': 'Cisco', '00:FF:DA': 'Cisco', '00:FF:F2': 'Cisco'
      };
      const lookupOui = mac => oui[mac.slice(0, 8).toUpperCase()] || '未知厂商';
      $('#macFormat', el).onclick = () => {
        const input = $('#macInput', el).value.trim();
        const result = $('#macResult', el);
        if (!input) { result.innerHTML = '<div class="empty">请输入 MAC 地址</div>'; return; }
        const formatted = formatMac(input);
        if (!formatted) { result.innerHTML = '<div class="empty">MAC 地址格式不正确（需要 12 位十六进制）</div>'; return; }
        result.innerHTML = `
        <div class="card">
          <table class="tbl"><tbody>
            <tr><td>标准格式</td><td><code>${formatted}</code></td></tr>
            <tr><td>无分隔符</td><td><code>${formatted.replace(/:/g, '')}</code></td></tr>
            <tr><td>厂商</td><td>${lookupOui(formatted)}</td></tr>
          </tbody></table>
        </div>`;
      };
      $('#macRandom', el).onclick = () => {
        const hex = Array.from({ length: 12 }, () => Math.floor(Math.random() * 16).toString(16).toUpperCase()).join('');
        $('#macInput', el).value = hex.match(/.{2}/g).join(':');
        $('#macFormat', el).onclick();
      };
    }
  },
  {
    id: 'unit', name: '单位换算', icon: '📏', cat: '实用',
    desc: '存储单位、时间单位快速换算',
    keywords: '单位 换算 存储 时间 byte kb mb gb tb',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>存储单位（1 KB = 1024 B）</label>
        <div class="row">
          <input id="storageInput" type="number" placeholder="输入数值" />
          <select id="storageFrom">
            <option value="B">B</option>
            <option value="KB" selected>KB</option>
            <option value="MB">MB</option>
            <option value="GB">GB</option>
            <option value="TB">TB</option>
            <option value="PB">PB</option>
          </select>
          <span>→</span>
          <select id="storageTo">
            <option value="B">B</option>
            <option value="KB">KB</option>
            <option value="MB" selected>MB</option>
            <option value="GB">GB</option>
            <option value="TB">TB</option>
            <option value="PB">PB</option>
          </select>
        </div>
        <div id="storageResult" class="hint"></div>
      </div>
      <div class="card">
        <label>时间单位</label>
        <div class="row">
          <input id="timeInput" type="number" placeholder="输入数值" />
          <select id="timeFrom">
            <option value="ms">毫秒 (ms)</option>
            <option value="s" selected>秒 (s)</option>
            <option value="min">分钟 (min)</option>
            <option value="h">小时 (h)</option>
            <option value="d">天 (d)</option>
          </select>
          <span>→</span>
          <select id="timeTo">
            <option value="ms">毫秒 (ms)</option>
            <option value="s">秒 (s)</option>
            <option value="min" selected>分钟 (min)</option>
            <option value="h">小时 (h)</option>
            <option value="d">天 (d)</option>
          </select>
        </div>
        <div id="timeResult" class="hint"></div>
      </div>`;
      const storageUnits = { B: 1, KB: 1024, MB: 1024 ** 2, GB: 1024 ** 3, TB: 1024 ** 4, PB: 1024 ** 5 };
      const timeUnits = { ms: 1, s: 1000, min: 60000, h: 3600000, d: 86400000 };
      const convert = () => {
        const sVal = parseFloat($('#storageInput', el).value);
        if (!isNaN(sVal)) {
          const result = sVal * storageUnits[$('#storageFrom', el).value] / storageUnits[$('#storageTo', el).value];
          $('#storageResult', el).textContent = `${sVal} ${$('#storageFrom', el).value} = ${result.toLocaleString()} ${$('#storageTo', el).value}`;
        }
        const tVal = parseFloat($('#timeInput', el).value);
        if (!isNaN(tVal)) {
          const result = tVal * timeUnits[$('#timeFrom', el).value] / timeUnits[$('#timeTo', el).value];
          $('#timeResult', el).textContent = `${tVal} ${$('#timeFrom', el).value} = ${result.toLocaleString()} ${$('#timeTo', el).value}`;
        }
      };
      ['storageInput', 'storageFrom', 'storageTo', 'timeInput', 'timeFrom', 'timeTo'].forEach(id => {
        $('#' + id, el).addEventListener('input', convert);
      });
    }
  },
  {
    id: 'cron', name: 'Cron 表达式解析', icon: '⏰', cat: '实用',
    desc: '解析 Cron 表达式，显示中文描述与下次执行时间',
    keywords: 'cron 定时 表达式 解析 下次执行',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>Cron 表达式（5 位）</label>
        <input id="cronInput" placeholder="如 */5 * * * * 或 0 2 * * 1-5" />
        <div class="btn-row">
          <button class="btn small" data-cron="*/5 * * * *">每 5 分钟</button>
          <button class="btn small" data-cron="0 2 * * *">每天 2 点</button>
          <button class="btn small" data-cron="0 0 * * 0">每周日</button>
          <button class="btn small" data-cron="0 0 1 * *">每月 1 号</button>
        </div>
        <div id="cronResult"></div>
      </div>`;
      const parseCron = expr => {
        const parts = expr.trim().split(/\s+/);
        if (parts.length !== 5) return null;
        return parts;
      };
      const describe = (field, name) => {
        if (field === '*') return `每${name}`;
        if (field.includes('/')) {
          const parts = field.split('/');
          if (parts[0] === '*') return `每 ${parts[1]} ${name}`;
          return `从 ${parts[0]} 开始每 ${parts[1]} ${name}`;
        }
        if (field.includes('-')) {
          const parts = field.split('-');
          return `${parts[0]} 到 ${parts[1]} ${name}`;
        }
        if (field.includes(',')) return field.split(',').join('、') + ` ${name}`;
        return `${field} ${name}`;
      };
      const getNextRuns = (expr, count) => {
        const parts = parseCron(expr);
        if (!parts) return [];
        const min = parts[0], hour = parts[1];
        const results = [];
        const now = new Date();
        for (let i = 1; i <= 60 * 24 * 7 && results.length < count; i++) {
          const next = new Date(now.getTime() + i * 60000);
          const minOk = min === '*' || min.split(',').some(p => {
            if (p.includes('-')) { const a = p.split('-'); return next.getMinutes() >= +a[0] && next.getMinutes() <= +a[1]; }
            if (p.includes('/')) { const a = p.split('/'); return a[0] === '*' ? next.getMinutes() % +a[1] === 0 : next.getMinutes() >= +a[0] && (next.getMinutes() - +a[0]) % +a[1] === 0; }
            return next.getMinutes() === +p;
          });
          const hourOk = hour === '*' || hour.split(',').some(p => {
            if (p.includes('-')) { const a = p.split('-'); return next.getHours() >= +a[0] && next.getHours() <= +a[1]; }
            if (p.includes('/')) { const a = p.split('/'); return a[0] === '*' ? next.getHours() % +a[1] === 0 : next.getHours() >= +a[0] && (next.getHours() - +a[0]) % +a[1] === 0; }
            return next.getHours() === +p;
          });
          if (minOk && hourOk) results.push(next);
        }
        return results;
      };
      const run = () => {
        const expr = $('#cronInput', el).value.trim();
        const result = $('#cronResult', el);
        if (!expr) { result.innerHTML = '<div class="empty">请输入 Cron 表达式</div>'; return; }
        const parts = parseCron(expr);
        if (!parts) { result.innerHTML = '<div class="empty">Cron 表达式格式不正确（需要 5 个字段：分 时 日 月 周）</div>'; return; }
        const desc = [
          describe(parts[0], '分钟'), describe(parts[1], '小时'),
          describe(parts[2], '日'), describe(parts[3], '月'), describe(parts[4], '星期')
        ].join('，');
        const nextRuns = getNextRuns(expr, 5);
        result.innerHTML = `
        <div class="card">
          <label>中文描述</label>
          <p>${desc}</p>
        </div>
        <div class="card">
          <label>下次执行时间</label>
          ${nextRuns.length ? nextRuns.map(d => `<div>${d.toLocaleString('zh-CN', { hour12: false })}</div>`).join('') : '<div class="empty">无法计算</div>'}
        </div>`;
      };
      $('#cronInput', el).addEventListener('input', run);
      $$('.btn-row .btn', el).forEach(btn => { btn.onclick = () => { $('#cronInput', el).value = btn.dataset.cron; run(); }; });
    }
  },
  {
    id: 'password', name: '随机密码生成器', icon: '🔑', cat: '实用',
    desc: '可定制长度与字符集的随机密码',
    keywords: '密码 password 随机 生成 强密码',
    render(el) {
      el.innerHTML = `
      <div class="card">
        <label>密码长度：<b id="pwLenVal">16</b></label>
        <input id="pwLen" type="range" min="4" max="64" value="16" />
        <div class="checks">
          <label class="chk"><input type="checkbox" id="pwD" checked /> 数字</label>
          <label class="chk"><input type="checkbox" id="pwL" checked /> 小写字母</label>
          <label class="chk"><input type="checkbox" id="pwU" checked /> 大写字母</label>
          <label class="chk"><input type="checkbox" id="pwS" /> 符号</label>
        </div>
        <div class="btn-row">
          <button class="btn" id="pwGen">生成 10 个密码</button>
          <button class="btn ghost" id="pwCopy">复制全部</button>
        </div>
        <div id="pwOut" class="pw-list"></div>
      </div>`;
      let last = [];
      const gen = () => {
        const len = +$('#pwLen', el).value;
        const sets = [];
        if ($('#pwD', el).checked) sets.push('0123456789');
        if ($('#pwL', el).checked) sets.push('abcdefghijklmnopqrstuvwxyz');
        if ($('#pwU', el).checked) sets.push('ABCDEFGHIJKLMNOPQRSTUVWXYZ');
        if ($('#pwS', el).checked) sets.push('!@#$%^&*()-_=+[]{}');
        if (!sets.length) { $('#pwOut', el).innerHTML = '<div class="empty">请至少选择一种字符集</div>'; last = []; return; }
        last = Array.from({ length: 10 }, () => makePwd(len, sets));
        $('#pwOut', el).innerHTML = last.map(p => `<div class="pw-row"><code>${p}</code><button class="btn small" data-p="${p}">复制</button></div>`).join('');
        $$('#pwOut button', el).forEach(b => { b.onclick = () => copyText(b.dataset.p, b); });
      };
      $('#pwLen', el).addEventListener('input', () => { $('#pwLenVal', el).textContent = $('#pwLen', el).value; });
      $('#pwGen', el).onclick = gen;
      $('#pwCopy', el).onclick = () => copyText(last.join('\n'), $('#pwCopy', el));
      gen();
    }
  }
];

function fallbackUuid() {
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, c => {
    const r = Math.random() * 16 | 0;
    return (c === 'x' ? r : (r & 0x3 | 0x8)).toString(16);
  });
}

function makePwd(len, sets) {
  const all = sets.join('');
  const rnd = n => { const a = new Uint32Array(1); crypto.getRandomValues(a); return a[0] % n; };
  const chars = sets.map(s => s[rnd(s.length)]);
  while (chars.length < len) chars.push(all[rnd(all.length)]);
  for (let i = chars.length - 1; i > 0; i--) {
    const j = rnd(i + 1);
    const t = chars[i]; chars[i] = chars[j]; chars[j] = t;
  }
  return chars.join('');
}

function recordRecent(id) {
  let r = store.get('recent', []).filter(x => x !== id);
  r.unshift(id);
  store.set('recent', r.slice(0, 8));
}

const section = (title, tools) => `
  <section class="cat">
    <h2>${title}</h2>
    <div class="grid">${tools.map(t => `
      <a class="tile" href="#/tool/${t.id}">
        <div class="tile-icon">${t.icon}</div>
        <div class="tile-name">${t.name}</div>
        <div class="tile-desc">${t.desc}</div>
      </a>`).join('')}
    </div>
  </section>`;

function renderHome() {
  document.title = 'IT 运维工具箱';
  const app = $('#app');
  const favs = store.get('favs', []);
  const recent = store.get('recent', []);
  app.innerHTML = `
  <section class="hero">
    <h1>IT 运维工具箱</h1>
    <p>网络计算 · 命令生成 · 文本处理 —— 运维人的随身百宝箱（共 ${TOOLS.length} 个工具）</p>
    <div class="search"><input id="searchInput" placeholder="搜索工具 / 命令，如：CIDR、端口、JSON…" autocomplete="off" /></div>
  </section>
  <div id="homeBody"></div>`;
  const body = $('#homeBody', app);
  const draw = kw => {
    const q = (kw || '').trim().toLowerCase();
    const match = t => !q || (t.name + t.desc + (t.keywords || '')).toLowerCase().includes(q);
    let out = '';
    if (!q) {
      if (favs.length) out += section('⭐ 我的收藏', TOOLS.filter(t => favs.includes(t.id)));
      if (recent.length) out += section('🕘 最近使用', TOOLS.filter(t => recent.includes(t.id)));
    }
    CATS.forEach(c => {
      const list = TOOLS.filter(t => t.cat === c && match(t));
      if (list.length) out += section(c, list);
    });
    body.innerHTML = out || `<div class="empty">没有找到「${escapeHtml(kw)}」相关工具</div>`;
  };
  draw('');
  $('#searchInput', app).addEventListener('input', e => draw(e.target.value));
}

function renderTool(t) {
  recordRecent(t.id);
  document.title = t.name + ' - IT 运维工具箱';
  const app = $('#app');
  const favs = store.get('favs', []);
  const isFav = favs.includes(t.id);
  app.innerHTML = `
  <a class="back" href="#/">← 返回首页</a>
  <div class="tool-head">
    <span class="tool-icon">${t.icon}</span>
    <div>
      <h1>${t.name}</h1>
      <p>${t.desc}</p>
    </div>
    <button class="star ${isFav ? 'on' : ''}" id="starBtn">${isFav ? '★' : '☆'}</button>
  </div>
  <div id="toolBody"></div>`;
  $('#starBtn', app).onclick = function () {
    let f = store.get('favs', []);
    const i = f.indexOf(t.id);
    if (i >= 0) { f.splice(i, 1); this.classList.remove('on'); this.textContent = '☆'; }
    else { f.push(t.id); this.classList.add('on'); this.textContent = '★'; }
    store.set('favs', f);
  };
  t.render($('#toolBody', app));
  window.scrollTo(0, 0);
}

function route() {
  cleanups.forEach(f => { try { f(); } catch (e) {} });
  cleanups = [];
  const h = location.hash || '#/';
  const parts = h.replace(/^#\//, '').split('/');
  if (parts[0] === 'tool') {
    const t = TOOLS.find(x => x.id === parts[1]);
    if (t) { renderTool(t); return; }
  }
  renderHome();
}

window.addEventListener('hashchange', route);
route();

})();
