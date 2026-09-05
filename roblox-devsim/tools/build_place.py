#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
Собирает готовый файл места Roblox (.rbxlx) из папки src/.

Ничего ставить не нужно: только Python 3. Ни Studio, ни Rojo, ни интернета.

    python3 roblox-devsim/tools/build_place.py
    python3 roblox-devsim/tools/build_place.py --out my_place.rbxlx

Что куда кладётся:
    src/shared/*.lua          -> ReplicatedStorage > DevSim > <Имя> (ModuleScript)
    src/server/*.server.lua   -> ServerScriptService > <Имя>        (Script)
    src/client/*.client.lua   -> StarterPlayer > StarterPlayerScripts > <Имя> (LocalScript)
"""

import argparse
import os
import sys

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SRC = os.path.join(ROOT, "src")

HEADER = (
    '<roblox xmlns:xmime="http://www.w3.org/2005/05/xmlmime" '
    'xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" '
    'xsi:noNamespaceSchemaLocation="http://www.roblox.com/roblox.xsd" version="4">'
)


class Ref:
    """Выдаёт уникальные referent-идентификаторы для XML."""

    def __init__(self):
        self.n = 0

    def next(self):
        self.n += 1
        return "RBX%08d" % self.n


def cdata(text):
    # Внутри CDATA нельзя встретить "]]>" — режем последовательность пополам.
    return text.replace("]]>", "]]]]><![CDATA[>")


def read_lua(path):
    with open(path, "r", encoding="utf-8") as fh:
        return fh.read()


def item(cls, name, ref, children="", source=None, indent=1):
    pad = "\t" * indent
    pad2 = "\t" * (indent + 1)
    pad3 = "\t" * (indent + 2)
    out = ['%s<Item class="%s" referent="%s">' % (pad, cls, ref.next())]
    out.append("%s<Properties>" % pad2)
    out.append('%s<string name="Name">%s</string>' % (pad3, name))
    if source is not None:
        out.append(
            '%s<ProtectedString name="Source"><![CDATA[\n%s\n]]></ProtectedString>'
            % (pad3, cdata(source))
        )
    out.append("%s</Properties>" % pad2)
    if children:
        out.append(children)
    out.append("%s</Item>" % pad)
    return "\n".join(out)


def collect(folder, suffix):
    """Возвращает [(имя_без_суффикса, исходник)] из папки, по алфавиту."""
    path = os.path.join(SRC, folder)
    if not os.path.isdir(path):
        return []
    found = []
    for filename in sorted(os.listdir(path)):
        if filename.endswith(suffix):
            name = filename[: -len(suffix)]
            found.append((name, read_lua(os.path.join(path, filename))))
    return found


def build():
    ref = Ref()
    parts = [HEADER]

    # --- Workspace (пустой: карту строит скрипт при запуске) ---
    parts.append(item("Workspace", "Workspace", ref))

    # --- Lighting ---
    parts.append(item("Lighting", "Lighting", ref))

    # --- ReplicatedStorage > DevSim > модули ---
    modules = collect("shared", ".lua")
    if not modules:
        sys.exit("В src/shared нет ни одного .lua — собирать нечего")
    module_items = "\n".join(
        item("ModuleScript", name, ref, source=src, indent=3) for name, src in modules
    )
    devsim = item("Folder", "DevSim", ref, children=module_items, indent=2)
    parts.append(item("ReplicatedStorage", "ReplicatedStorage", ref, children=devsim))

    # --- ServerScriptService > серверные скрипты ---
    servers = collect("server", ".server.lua")
    server_items = "\n".join(
        item("Script", name, ref, source=src, indent=2) for name, src in servers
    )
    parts.append(item("ServerScriptService", "ServerScriptService", ref, children=server_items))

    # --- StarterPlayer > StarterPlayerScripts > клиентские скрипты ---
    clients = collect("client", ".client.lua")
    client_items = "\n".join(
        item("LocalScript", name, ref, source=src, indent=3) for name, src in clients
    )
    sps = item("StarterPlayerScripts", "StarterPlayerScripts", ref, children=client_items, indent=2)
    parts.append(item("StarterPlayer", "StarterPlayer", ref, children=sps))

    parts.append("</roblox>")
    return "\n".join(parts) + "\n", modules, servers, clients


def main():
    ap = argparse.ArgumentParser(description="Сборка .rbxlx из src/")
    ap.add_argument(
        "--out",
        default=os.path.join(ROOT, "build", "DevSim.rbxlx"),
        help="куда положить готовый файл",
    )
    args = ap.parse_args()

    xml, modules, servers, clients = build()

    out_dir = os.path.dirname(os.path.abspath(args.out))
    if out_dir:
        os.makedirs(out_dir, exist_ok=True)
    with open(args.out, "w", encoding="utf-8") as fh:
        fh.write(xml)

    size_kb = os.path.getsize(args.out) / 1024.0
    print("Готово: %s  (%.1f КБ)" % (args.out, size_kb))
    print("  модулей: %s" % ", ".join(n for n, _ in modules))
    print("  сервер:  %s" % ", ".join(n for n, _ in servers))
    print("  клиент:  %s" % ", ".join(n for n, _ in clients))
    print("\nОткрой файл в Roblox Studio (двойной клик) и жми Play.")


if __name__ == "__main__":
    main()
