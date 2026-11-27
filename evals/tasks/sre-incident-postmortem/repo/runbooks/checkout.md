# checkout: errors above the SLO

Owner: Payments · on-call: the payments rotation

## 1. Count the failed checkouts [check]
```sh
grep -c ' 500 ' logs/checkout.log
```
expect: /^[0-9]+$/

## 2. Which upstream fails [check]
```sh
grep -o 'upstream=[a-z-]*' logs/checkout.log | sort | uniq -c | sort -rn
```
expect: the upstream that fails most

## 3. What was deployed around the start [check]
```sh
cat logs/deploys.log
```
expect: a release just before the first error

## 4. Roll back the release [action]
```sh
kubectl -n shop rollout undo deploy/checkout
```
expect: rolled back

## 5. Page the payments gateway team? [decision]
expect: decided with the on-call
