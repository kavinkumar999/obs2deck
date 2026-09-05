---
tags:
  - hld
  - system-design
---

# ⚡️ Caching Fundamentals

> [!abstract]
> 🌐 📋 Caching moves hot data into faster storage to cut latency.

## Overview

- Cache data that is read frequently.
- Key goals: reduce round-trips, see [[Caching Strategies]] and ==hit ratio==.

![[HLD/_resources/ea791949e17991b65863686fdfd76386_MD5.png]]

## Request Flow 🔁

1. Client issues a read.
2. Cache lookup executes.

![[HLD/_resources/827c8e34b5c025adf6d702214cbf29dd_MD5.png]]
![[HLD/_resources/649991dcb1beba40d03b20aae7c40450_MD5.png]]

> [!note] Watch these
> 🔵 ✏ Monitor hit/miss ratio and latency.

## Eviction Policies

| Policy | When |
|--------|------|
| LRU | Temporal locality |
| LFU | Stable access patterns |

```sql
-- a --- inside code must not split
SELECT 1;
```

## Long section

### Part A
- a1
- a2
- a3
- a4
- a5
- a6

### Part B
- b1
- b2
- b3
- b4
- b5
- b6

## Links

See [[HLD/Load Balancer|the balancer]] and [[CAP Theorem#Consistency]] and %%hidden%% ![[Machine Learning/_resources/x y.png|"Spaced"]].
