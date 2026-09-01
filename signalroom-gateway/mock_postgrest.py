"""
Sostituto minimo di PostgREST per i test locali: traduce le due forme di
chiamata che signalroom-gateway/app.py usa (POST rpc/<fn>, GET tabella con
filtri semplici eq./in./order/limit) in query dirette su Postgres via
psycopg2, cosi' possiamo far girare app.py vero contro un database vero
senza toccare il progetto Supabase reale. Non è PostgREST: è solo abbastanza
per validare la nostra logica end-to-end in locale.
"""

from __future__ import annotations

import json

import psycopg2
import psycopg2.extras
from aiohttp import web

DSN = "dbname=signaltest user=root host=/var/run/postgresql"


def _conn():
    c = psycopg2.connect(DSN)
    c.autocommit = True
    return c


async def handle_rpc(request: web.Request) -> web.Response:
    fn = request.match_info["fn"]
    body = await request.json()
    # psycopg2 non adatta da solo dict/list Python -> jsonb: li avvolgiamo
    # esplicitamente (PostgREST reale fa questa conversione da solo).
    body = {
        k: (psycopg2.extras.Json(v) if isinstance(v, (dict, list)) else v)
        for k, v in body.items()
    }
    cols = ", ".join(f"{k} => %({k})s" for k in body)
    sql = f"select public.{fn}({cols}) as risultato"
    try:
        with _conn() as conn, conn.cursor() as cur:
            cur.execute(sql, body)
            row = cur.fetchone()
            valore = row[0] if row else None
        return web.json_response(valore)
    except psycopg2.Error as exc:
        return web.json_response({"message": str(exc)}, status=400)


async def handle_table(request: web.Request) -> web.Response:
    table = request.match_info["table"]
    q = request.rel_url.query
    where = []
    params: dict = {}
    for i, (k, v) in enumerate(q.items()):
        if k in ("order", "limit", "select"):
            continue
        if v.startswith("eq."):
            where.append(f"{k} = %(p{i})s")
            params[f"p{i}"] = v[3:]
        elif v.startswith("in."):
            valori = v[3:].strip("()").split(",")
            placeholders = []
            for j, val in enumerate(valori):
                key = f"p{i}_{j}"
                placeholders.append(f"%({key})s")
                params[key] = val
            where.append(f"{k} in ({', '.join(placeholders)})")
    sql = f"select * from public.{table}"
    if where:
        sql += " where " + " and ".join(where)
    if "order" in q:
        col, _, direzione = q["order"].partition(".")
        sql += f" order by {col} {direzione.upper() if direzione else ''}"
    if "limit" in q:
        sql += f" limit {int(q['limit'])}"

    with _conn() as conn, conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor) as cur:
        cur.execute(sql, params)
        righe = cur.fetchall()
    return web.json_response(righe, dumps=lambda o: json.dumps(o, default=str))


def crea_mock_app() -> web.Application:
    app = web.Application()
    app.router.add_post("/rest/v1/rpc/{fn}", handle_rpc)
    app.router.add_get("/rest/v1/{table}", handle_table)
    return app


if __name__ == "__main__":
    web.run_app(crea_mock_app(), port=8091)
