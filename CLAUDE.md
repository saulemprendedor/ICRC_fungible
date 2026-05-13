# ICRC_fungible — Notas para agentes

Implementación Motoko ICRC-1/2/3/4 con tests PocketIC. Librería ICRC genérica reutilizable.

## ⚠️ Aislamiento de proyectos consumidores

**Este repo es una librería ICRC pura.** Ningún proyecto consumidor (token name, símbolo, principals, deploy checklists específicos) debe ser commiteado aquí.

- ❌ NO subir archivos `*_CHECKLIST.md`, deploy notes, ni configs de token específico
- ❌ NO mencionar nombres de tokens / principals concretos en commit messages
- ❌ NO referenciar paths de proyectos consumidores (`../<consumer>/...`) en código ni docs
- ✅ Mantener defaults genéricos en `Token.mo` (`"Test Token"`, `"TTT"`, etc.)
- ✅ Toda configuración específica del consumidor va en el repo consumidor vía init args

Si encontrás contenido que viola estas reglas, eliminarlo del repo. Si está en history público, reescribir historia + force-push (filter-branch / filter-repo) y avisar al user.

## Tooling

- **Build**: `dfx` (interno) o `icp-cli` desde otro proyecto que importe `src/Token.mo`
- **Tests pic-ic**: `runners/run_dfinity_tests.sh`, `runners/test_deploy.sh`
- **Deploy prod**: `runners/prod_deploy.sh` (mainnet, requiere `production_icrc_deployer` identity)

## Token.mo init args — patrón corregido

`src/Token.mo` línea 31-36 firma del constructor:
```motoko
shared ({ caller = _owner }) persistent actor class Token (args: ?{
    icrc1 : ?ICRC1.InitArgs;
    icrc2 : ?ICRC2.InitArgs;
    icrc3 : ?ICRC3.InitArgs;   // CRITICAL: opt — NO cambiar a non-opt
    icrc4 : ?ICRC4.InitArgs;
})
```

**Por qué `icrc3` es opt:** antes era `icrc3 : ICRC3.InitArgs` (no-opt). Esa shape detona un bug de candid decode en icp-cli + moc 1.3.0 — el constructor recibe `null` aunque install pase OK. Token.mo siempre caía a `default_icrc1_args` ("Test Token", 8 decimals, fee 10000) sin importar qué args se mandaran.

**NO revertir el cambio.** Si una nueva versión del ICRC3 lib requiere field no-opt, encapsular en wrapper opt:
```motoko
args : ?{ ...; icrc3 : ?{ inner: ICRC3.RequiredInitArgs }; ... }
```

## Pasar args al deploy

Todos los scripts en `runners/` y `test/integration/` usan:
```candid
icrc3 = opt record { maxActiveRecords = 3000; ... }
```

Si agregás nuevo script/test que llama `Token.mo`, usar `opt record`. `icrc3 = record { ... }` falla silenciosamente.

**Anotar tipos numéricos en candid CLI** — sin `: nat` el decode silenciosamente cae a default sin error:
```candid
fee = opt variant { Fixed = 10_000_000 : nat }   # ✅
fee = opt variant { Fixed = 10000000 }            # ❌ puede no aplicar
```

## Estructura

```
src/
  Token.mo              ← persistent actor class principal (ICRC-1/2/3/4)
  snstest.mo            ← variante para tests SNS
  examples/             ← Lotto.mo, Allowlist.mo
runners/
  prod_deploy.sh        ← deploy mainnet con --mode install --args
  test_deploy.sh        ← deploy local con --args (icp deploy)
  run_dfinity_tests.sh
  run_all_tests.sh
test/integration/       ← scripts de tests (index_ng, index_mo, rosetta, etc.)
pic/                    ← PocketIC tests Motoko
.mops/                  ← dependencias mops (gitignored, generadas)
```

## Convenciones repo

- No subir `.mops/` (mops install local).
- `icrc1-mo@0.2.1` es la versión actual (`mops.toml`).
- `[toolchain] moc = "1.3.0"`.
- Cualquier cambio a `Token.mo` args shape requiere actualizar TODOS los scripts en `runners/` y `test/integration/` que pasen args.
