#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum ResolutionSource {
    System,
    DohCached,
    DohFresh,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) enum TransportFailure {
    Connect,
    Other,
}

pub(crate) fn cache_is_fresh(expires_at: std::time::Instant, now: std::time::Instant) -> bool {
    expires_at > now
}

pub(crate) fn should_use_portal_resolver(request_host: Option<&str>, portal_host: &str) -> bool {
    request_host == Some(portal_host)
}

pub(crate) fn preferred_source(has_cached_doh: bool, system_resolved: bool) -> ResolutionSource {
    if has_cached_doh {
        ResolutionSource::DohCached
    } else if system_resolved {
        ResolutionSource::System
    } else {
        ResolutionSource::DohFresh
    }
}

pub(crate) fn fallback_sources(
    primary: ResolutionSource,
    failure: TransportFailure,
) -> [Option<ResolutionSource>; 2] {
    if failure != TransportFailure::Connect {
        return [None, None];
    }

    match primary {
        ResolutionSource::System => [Some(ResolutionSource::DohFresh), None],
        ResolutionSource::DohCached => [
            Some(ResolutionSource::System),
            Some(ResolutionSource::DohFresh),
        ],
        ResolutionSource::DohFresh => [Some(ResolutionSource::System), None],
    }
}

#[cfg(test)]
mod tests {
    use super::{
        cache_is_fresh, fallback_sources, preferred_source, should_use_portal_resolver,
        ResolutionSource, TransportFailure,
    };
    use std::time::{Duration, Instant};

    #[test]
    fn cache_is_valid_only_before_its_expiry() {
        let now = Instant::now();
        assert!(cache_is_fresh(now + Duration::from_secs(1), now));
        assert!(!cache_is_fresh(now, now));
        assert!(!cache_is_fresh(now - Duration::from_secs(1), now));
    }

    #[test]
    fn external_skin_hosts_bypass_the_portal_resolver() {
        assert!(should_use_portal_resolver(Some("varryal.ru"), "varryal.ru"));
        assert!(!should_use_portal_resolver(
            Some("media.example"),
            "varryal.ru"
        ));
        assert!(!should_use_portal_resolver(None, "varryal.ru"));
    }

    #[test]
    fn cached_doh_skips_repeated_system_resolution() {
        assert_eq!(preferred_source(true, false), ResolutionSource::DohCached);
        assert_eq!(preferred_source(true, true), ResolutionSource::DohCached);
    }

    #[test]
    fn system_dns_is_primary_when_there_is_no_cached_doh_answer() {
        assert_eq!(preferred_source(false, true), ResolutionSource::System);
        assert_eq!(preferred_source(false, false), ResolutionSource::DohFresh);
    }

    #[test]
    fn only_connect_failures_switch_resolvers() {
        assert_eq!(
            fallback_sources(ResolutionSource::System, TransportFailure::Connect),
            [Some(ResolutionSource::DohFresh), None]
        );
        assert_eq!(
            fallback_sources(ResolutionSource::System, TransportFailure::Other),
            [None, None]
        );
    }

    #[test]
    fn stale_cached_doh_tries_system_then_refreshes_doh() {
        assert_eq!(
            fallback_sources(ResolutionSource::DohCached, TransportFailure::Connect),
            [
                Some(ResolutionSource::System),
                Some(ResolutionSource::DohFresh)
            ]
        );
        assert_eq!(
            fallback_sources(ResolutionSource::DohFresh, TransportFailure::Connect),
            [Some(ResolutionSource::System), None]
        );
    }
}
