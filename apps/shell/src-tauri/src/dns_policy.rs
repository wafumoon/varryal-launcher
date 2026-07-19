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

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub(crate) struct CacheVersion {
    pub(crate) generation: u64,
    pub(crate) refresh: u64,
}

impl CacheVersion {
    pub(crate) const fn new(generation: u64, refresh: u64) -> Self {
        Self {
            generation,
            refresh,
        }
    }
}

pub(crate) fn should_commit_cache_refresh(
    current_generation: u64,
    current_entry: Option<CacheVersion>,
    candidate: CacheVersion,
) -> bool {
    candidate.generation == current_generation
        && current_entry.map_or(true, |current| candidate.refresh > current.refresh)
}

pub(crate) fn should_invalidate_cache(
    current_entry: Option<CacheVersion>,
    used_entry: CacheVersion,
) -> bool {
    current_entry == Some(used_entry)
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
        cache_is_fresh, fallback_sources, preferred_source, should_commit_cache_refresh,
        should_invalidate_cache, should_use_portal_resolver, CacheVersion, ResolutionSource,
        TransportFailure,
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
    fn stale_refresh_cannot_overwrite_a_newer_cache_generation_or_entry() {
        let old = CacheVersion::new(7, 1);
        let newer = CacheVersion::new(7, 2);
        let next_generation = CacheVersion::new(8, 1);

        assert!(should_commit_cache_refresh(7, None, old));
        assert!(should_commit_cache_refresh(7, Some(old), newer));
        assert!(!should_commit_cache_refresh(7, Some(newer), old));
        assert!(!should_commit_cache_refresh(8, None, old));
        assert!(should_commit_cache_refresh(8, None, next_generation));
    }

    #[test]
    fn connect_failure_invalidates_only_the_exact_cached_snapshot_it_used() {
        let used = CacheVersion::new(4, 9);
        let replacement = CacheVersion::new(4, 10);

        assert!(should_invalidate_cache(Some(used), used));
        assert!(!should_invalidate_cache(Some(replacement), used));
        assert!(!should_invalidate_cache(None, used));
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
