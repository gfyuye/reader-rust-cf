use std::net::{IpAddr, Ipv4Addr, Ipv6Addr};
use url::{Host, Url};

fn is_private_or_local_ipv4(ip: Ipv4Addr) -> bool {
    let octets = ip.octets();
    ip.is_loopback() // 127.0.0.0/8
        || ip.is_link_local() // 169.254.0.0/16
        || ip.is_unspecified() // 0.0.0.0
        || ip.is_broadcast() // 255.255.255.255
        || octets[0] == 10 // 10.0.0.0/8
        || (octets[0] == 172 && (16..=31).contains(&octets[1])) // 172.16.0.0/12
        || (octets[0] == 192 && octets[1] == 168) // 192.168.0.0/16
        || (octets[0] == 100 && (64..=127).contains(&octets[1])) // CGNAT 100.64.0.0/10
        || (octets[0] == 192 && octets[1] == 0 && octets[2] == 2) // TEST-NET-1
        || (octets[0] == 198 && (octets[1] == 18 || octets[1] == 19)) // Benchmarking
        || (octets[0] == 198 && octets[1] == 51 && octets[2] == 100) // TEST-NET-2
        || (octets[0] == 203 && octets[1] == 0 && octets[2] == 113) // TEST-NET-3
}

fn is_private_or_local_ipv6(ip: Ipv6Addr) -> bool {
    if ip.is_loopback() || ip.is_unspecified() {
        return true;
    }
    let segments = ip.segments();
    // Unique local (fc00::/7)
    if (segments[0] & 0xfe00) == 0xfc00 {
        return true;
    }
    // Link local (fe80::/10)
    if (segments[0] & 0xffc0) == 0xfe80 {
        return true;
    }
    // IPv4-mapped IPv6 (::ffff:127.0.0.1)
    let octets = ip.octets();
    if octets[0..10] == [0; 10] && octets[10] == 0xff && octets[11] == 0xff {
        let v4 = Ipv4Addr::new(octets[12], octets[13], octets[14], octets[15]);
        return is_private_or_local_ipv4(v4);
    }
    false
}

fn is_private_or_local_ip(ip: IpAddr) -> bool {
    match ip {
        IpAddr::V4(v4) => is_private_or_local_ipv4(v4),
        IpAddr::V6(v6) => is_private_or_local_ipv6(v6),
    }
}

pub async fn validate_safe_url(raw: &str) -> Result<Url, String> {
    let url = Url::parse(raw.trim()).map_err(|e| format!("无效的 URL: {}", e))?;
    match url.scheme() {
        "http" | "https" => {}
        other => return Err(format!("不支持的协议: {}", other)),
    }
    let host = url.host().ok_or_else(|| "缺少主机名".to_string())?;
    match host {
        Host::Ipv4(ip) => {
            if is_private_or_local_ipv4(ip) {
                return Err("禁止访问内网或本地 IP 地址".to_string());
            }
        }
        Host::Ipv6(ip) => {
            if is_private_or_local_ipv6(ip) {
                return Err("禁止访问内网或本地 IP 地址".to_string());
            }
        }
        Host::Domain(domain) => {
            let lower = domain.to_lowercase();
            if lower == "localhost"
                || lower.ends_with(".localhost")
                || lower.ends_with(".local")
                || lower.ends_with(".internal")
                || lower.ends_with(".lan")
            {
                return Err("禁止访问本地或内网域名".to_string());
            }
            let port = url.port_or_known_default().unwrap_or(80);
            if let Ok(addrs) = tokio::net::lookup_host(format!("{}:{}", domain, port)).await {
                for addr in addrs {
                    if is_private_or_local_ip(addr.ip()) {
                        return Err("目标域名解析为内网或本地地址，已拦截 (SSRF 防御)".to_string());
                    }
                }
            }
        }
    }
    Ok(url)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn test_blocked_urls() {
        assert!(validate_safe_url("http://127.0.0.1/admin").await.is_err());
        assert!(validate_safe_url("http://localhost:8080").await.is_err());
        assert!(validate_safe_url("http://192.168.1.1/secret").await.is_err());
        assert!(validate_safe_url("http://10.0.0.1/").await.is_err());
        assert!(validate_safe_url("http://172.16.0.1/").await.is_err());
        assert!(validate_safe_url("http://169.254.169.254/latest/meta-data/").await.is_err());
        assert!(validate_safe_url("ftp://example.com/file").await.is_err());
        assert!(validate_safe_url("http://[::1]/").await.is_err());
    }

    #[tokio::test]
    async fn test_allowed_urls() {
        assert!(validate_safe_url("https://example.com").await.is_ok());
    }
}
