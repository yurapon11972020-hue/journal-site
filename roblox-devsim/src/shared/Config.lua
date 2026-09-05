--========================================================================
--  СИМУЛЯТОР РАЗРАБОТЧИКА — КОНФИГ
--  ЭТО ЕДИНСТВЕННЫЙ ФАЙЛ, КОТОРЫЙ НУЖНО ПРАВИТЬ РУКАМИ.
--  Тут: твой UserId, ID геймпассов и товаров, цены, зоны, коды, награды.
--  Лежит в ReplicatedStorage > DevSim > Config
--========================================================================

local Config = {}

Config.VERSION = "v11"

--========================================================================
--  1. АДМИНКА
--========================================================================
-- Впиши свой Roblox UserId, чтобы админка работала и на живом сервере.
-- Владелец игры и режим Studio получают доступ автоматически.
Config.ADMINS = {
    -- [123456789] = true,
}
-- Секретная фраза в чат — открывает админ-панель (ещё есть Ctrl+K).
Config.ADMIN_SECRET = "devpanel"

--========================================================================
--  2. МОНЕТИЗАЦИЯ — ID ГЕЙМПАССОВ И ТОВАРОВ
--  Где взять: create.roblox.com -> твоя игра -> Monetization ->
--  Passes / Developer Products. Скопируй ID и вставь сюда.
--  0 = не настроено (кнопка в игре покажет "СКОРО" и не сломается).
--========================================================================
Config.GAMEPASSES = {
    AutoClick   = 1879846483,   -- авто-написание кода
    AutoSell    = 1879222553,   -- авто-продажа, когда рюкзак полон
    Money2x     = 1879186534,   -- x2 деньги навсегда
    Clicks2x    = 1879804484,   -- x2 кода за клик навсегда
    VIPTeleport = 1879978481,   -- мгновенный телепорт + вход в VIP-лофт
    -- Новые — создай на сайте и вставь ID:
    LuckyPass   = 0,            -- x2 награды с колеса и сундуков навсегда
    Turbo       = 0,            -- авто-клик работает в 3 раза быстрее
}

Config.PRODUCTS = {
    -- Разовые пачки денег (можно покупать много раз — главный источник Robux)
    Cash1   = 3604974414,       -- маленькая пачка
    Cash2   = 3604974568,       -- средняя пачка
    Cash3   = 3604974730,       -- большая пачка
    Rebirth = 3604975146,       -- купить ребёрт за Robux
    -- Новые — создай на сайте и вставь ID:
    Cash4        = 0,           -- огромная пачка
    Boost2xMoney = 0,           -- x2 деньги на 20 минут
    Boost2xCode  = 0,           -- x2 кода на 20 минут
    ServerBoost  = 0,           -- x2 ВСЕМУ СЕРВЕРУ на 10 минут (имя игрока в баннере)
    WheelSpin    = 0,           -- крутануть колесо удачи прямо сейчас
    StarterPack  = 0,           -- стартовый набор (покупается один раз)
    SkipRebirth  = 0,           -- мгновенно +3 ребёрта
}

-- Сколько денег дают пачки.
Config.CASH_AMOUNT = {
    Cash1 = 5000,
    Cash2 = 75000,
    Cash3 = 750000,
    Cash4 = 10000000,
}

-- Цена в Robux. РЕАЛЬНАЯ цена ставится на сайте Roblox;
-- эти числа нужны только для лидерборда донатеров и подписей в меню.
Config.PRICES = {
    AutoClick = 149, AutoSell = 149, Money2x = 199, Clicks2x = 199,
    VIPTeleport = 99, LuckyPass = 249, Turbo = 129,
    Cash1 = 10, Cash2 = 149, Cash3 = 349, Cash4 = 799,
    Rebirth = 39, Boost2xMoney = 49, Boost2xCode = 49, ServerBoost = 99,
    WheelSpin = 25, StarterPack = 99, SkipRebirth = 199,
}

-- Русские названия для меню и объявлений в чате.
Config.NAMES = {
    AutoClick    = "🤖 Авто-клик",
    AutoSell     = "📤 Авто-продажа",
    Money2x      = "💰 x2 Деньги навсегда",
    Clicks2x     = "⌨️ x2 Кода за клик",
    VIPTeleport  = "👑 VIP: телепорт и лофт",
    LuckyPass    = "🍀 Удача x2 (награды)",
    Turbo        = "⚡ Турбо авто-клик x3",
    Cash1        = "💵 Пачка $5K",
    Cash2        = "💵 Пачка $75K",
    Cash3        = "💵 Пачка $750K",
    Cash4        = "💵 Чемодан $10M",
    Rebirth      = "🌟 Купить ребёрт",
    SkipRebirth  = "🌟 Сразу +3 ребёрта",
    Boost2xMoney = "⚡ x2 Деньги 20 мин",
    Boost2xCode  = "⚡ x2 Код 20 мин",
    ServerBoost  = "🔥 x2 ВСЕМУ СЕРВЕРУ",
    WheelSpin    = "🎰 Прокрут колеса",
    StarterPack  = "🎒 Стартовый набор",
}

-- Порядок товаров в донат-меню (сверху вниз).
Config.SHOP_ORDER = {
    "StarterPack", "ServerBoost", "Boost2xMoney", "Boost2xCode", "WheelSpin",
    "AutoClick", "AutoSell", "Money2x", "Clicks2x", "Turbo", "LuckyPass", "VIPTeleport",
    "Cash1", "Cash2", "Cash3", "Cash4", "Rebirth", "SkipRebirth",
}

-- Какие ключи — постоянные покупки (геймпассы). Нужно клиенту, чтобы
-- показывать "Есть ✓" вместо цены.
Config.OWNED_FLAG = {
    AutoClick   = "OwnAutoClick",
    AutoSell    = "OwnAutoSell",
    Money2x     = "Own2xMoney",
    Clicks2x    = "Own2xClicks",
    VIPTeleport = "OwnVIP",
    LuckyPass   = "OwnLucky",
    Turbo       = "OwnTurbo",
}

-- Временные бусты: что даёт покупка и на сколько секунд.
-- kind = "money" (множитель денег) или "code" (множитель кода за клик).
Config.BOOSTS = {
    Boost2xMoney = {name = "x2 Деньги 20 мин", kind = "money", mult = 2, time = 1200},
    Boost2xCode  = {name = "x2 Код 20 мин",    kind = "code",  mult = 2, time = 1200},
}
-- Серверный буст (покупает один — радуются все).
Config.SERVER_BOOST = {name = "x2 ВСЕМУ СЕРВЕРУ", mult = 2, time = 600}

-- Стартовый набор: покупается один раз на аккаунт.
Config.STARTER_PACK = {
    money = 25000,
    boostMoney = 1800,          -- секунд x2 денег
    autoClick = true,           -- выдаёт авто-клик
}

--========================================================================
--  3. ПРОГРЕСС
--========================================================================
Config.START_CAPACITY = 25
Config.AUTOSAVE_EVERY = 60
Config.CLICK_LIMIT    = 25      -- максимум кликов в секунду (анти-чит)
Config.BACKPACK_MAX   = 60
Config.SELL_MAX       = 60

-- Компьютеры: сколько кода даёт один клик.
Config.GEAR = {
    {name = "Старый ПК",        perClick = 1,    cost = 0},
    {name = "Ноутбук",          perClick = 3,    cost = 150},
    {name = "Игровой ПК",       perClick = 8,    cost = 800},
    {name = "Рабочая станция",  perClick = 20,   cost = 3500},
    {name = "Мощный сервер",    perClick = 50,   cost = 15000},
    {name = "Дата-центр",       perClick = 130,  cost = 60000},
    {name = "ИИ-кластер",       perClick = 350,  cost = 250000},
    {name = "Квантовый ПК",     perClick = 900,  cost = 1000000},
}

function Config.backpackCapacity(level) return Config.START_CAPACITY + level * 20 end
function Config.backpackCost(level)     return math.floor(80 * (1.6 ^ level)) end
function Config.sellValue(level)        return 1 + level * 0.5 end
function Config.sellCost(level)         return math.floor(150 * (1.7 ^ level)) end
function Config.rebirthRequirement(r)   return math.floor(10000 * ((r + 1) ^ 1.6)) end
function Config.rebirthMoneyMult(r)     return 1 + r * 0.5 end
function Config.rebirthClickMult(r)     return 1 + r * 0.25 end

--========================================================================
--  4. ЗОНЫ — СЮЖЕТ КАРТЫ
--  Путь разработчика: гараж -> стартап -> кампус -> долина -> космос.
--  palette  — цвета построек этой эпохи
--  sky      — освещение, которое включается у игрока внутри зоны
--========================================================================
Config.ZONE_GAP  = 440          -- расстояние между центрами островов
Config.ISLAND    = 300          -- размер квадратного острова

Config.ZONES = {
    {
        name = "Гараж", story = "2009 · первый компьютер",
        mult = 1, needRebirth = 0, needMoney = 0,
        maxGear = 2, maxBackpack = 8, maxSell = 6,
        palette = {
            ground  = Color3.fromRGB(126, 205, 96),
            ground2 = Color3.fromRGB(108, 188, 84),
            rock    = Color3.fromRGB(122, 92, 66),
            accent  = Color3.fromRGB(0, 229, 190),
            wall    = Color3.fromRGB(238, 226, 200),
            roof    = Color3.fromRGB(198, 92, 72),
            trim    = Color3.fromRGB(120, 84, 58),
        },
        sky = {
            clock = 7.4, brightness = 2.3,
            ambient = Color3.fromRGB(120, 118, 132),
            outdoor = Color3.fromRGB(150, 140, 150),
            fog     = Color3.fromRGB(255, 214, 178),
            tint    = Color3.fromRGB(255, 246, 232),
            density = 0.28, saturation = 0.14, stars = 0,
        },
    },
    {
        name = "Стартап-офис", story = "первый инвестор и бесконечный кофе",
        mult = 3, needRebirth = 0, needMoney = 5000,
        maxGear = 3, maxBackpack = 16, maxSell = 14,
        palette = {
            ground  = Color3.fromRGB(196, 205, 214),
            ground2 = Color3.fromRGB(170, 182, 196),
            rock    = Color3.fromRGB(96, 108, 126),
            accent  = Color3.fromRGB(64, 168, 255),
            wall    = Color3.fromRGB(246, 249, 255),
            roof    = Color3.fromRGB(58, 74, 102),
            trim    = Color3.fromRGB(120, 200, 255),
        },
        sky = {
            clock = 10.5, brightness = 2.6,
            ambient = Color3.fromRGB(132, 140, 156),
            outdoor = Color3.fromRGB(148, 158, 178),
            fog     = Color3.fromRGB(205, 226, 255),
            tint    = Color3.fromRGB(246, 250, 255),
            density = 0.2, saturation = 0.1, stars = 0,
        },
    },
    {
        name = "IT-кампус", story = "своя команда, свои серверы",
        mult = 10, needRebirth = 1, needMoney = 0,
        maxGear = 5, maxBackpack = 28, maxSell = 26,
        palette = {
            ground  = Color3.fromRGB(144, 214, 128),
            ground2 = Color3.fromRGB(120, 194, 110),
            rock    = Color3.fromRGB(104, 112, 104),
            accent  = Color3.fromRGB(120, 255, 150),
            wall    = Color3.fromRGB(232, 240, 236),
            roof    = Color3.fromRGB(60, 132, 96),
            trim    = Color3.fromRGB(150, 240, 190),
        },
        sky = {
            clock = 13.0, brightness = 2.8,
            ambient = Color3.fromRGB(142, 150, 152),
            outdoor = Color3.fromRGB(160, 172, 170),
            fog     = Color3.fromRGB(214, 240, 224),
            tint    = Color3.fromRGB(250, 255, 250),
            density = 0.18, saturation = 0.16, stars = 0,
        },
    },
    {
        name = "Кремниевая долина", story = "IPO, небоскрёб и золотые часы",
        mult = 35, needRebirth = 3, needMoney = 0,
        maxGear = 6, maxBackpack = 42, maxSell = 42,
        palette = {
            ground  = Color3.fromRGB(226, 196, 128),
            ground2 = Color3.fromRGB(206, 172, 104),
            rock    = Color3.fromRGB(150, 118, 76),
            accent  = Color3.fromRGB(255, 196, 60),
            wall    = Color3.fromRGB(252, 244, 224),
            roof    = Color3.fromRGB(196, 148, 52),
            trim    = Color3.fromRGB(255, 226, 140),
        },
        sky = {
            clock = 17.4, brightness = 2.4,
            ambient = Color3.fromRGB(140, 122, 108),
            outdoor = Color3.fromRGB(168, 140, 116),
            fog     = Color3.fromRGB(255, 196, 138),
            tint    = Color3.fromRGB(255, 240, 214),
            density = 0.32, saturation = 0.2, stars = 0,
        },
    },
    {
        name = "Космо-штаб", story = "код, который управляет орбитой",
        mult = 120, needRebirth = 6, needMoney = 0,
        maxGear = 8, maxBackpack = 60, maxSell = 60,
        palette = {
            ground  = Color3.fromRGB(58, 60, 84),
            ground2 = Color3.fromRGB(44, 46, 68),
            rock    = Color3.fromRGB(38, 40, 58),
            accent  = Color3.fromRGB(196, 96, 255),
            wall    = Color3.fromRGB(74, 78, 108),
            roof    = Color3.fromRGB(40, 42, 62),
            trim    = Color3.fromRGB(140, 200, 255),
        },
        sky = {
            clock = 0.2, brightness = 1.5,
            ambient = Color3.fromRGB(72, 68, 104),
            outdoor = Color3.fromRGB(58, 56, 90),
            fog     = Color3.fromRGB(70, 58, 120),
            tint    = Color3.fromRGB(226, 224, 255),
            density = 0.42, saturation = 0.26, stars = 4000,
        },
    },
}

--========================================================================
--  5. НАГРАДЫ ЗА ВОЗВРАЩЕНИЕ (ежедневный сундук)
--  Заходишь каждый день — награда растёт. Пропустил день — серия сгорает.
--========================================================================
Config.DAILY = {
    {money = 2500,     text = "$2.5K"},
    {money = 8000,     text = "$8K"},
    {money = 25000,    text = "$25K"},
    {money = 80000,    boost = {kind = "money", mult = 2, time = 600}, text = "$80K + x2 на 10 мин"},
    {money = 250000,   text = "$250K"},
    {money = 800000,   boost = {kind = "code", mult = 2, time = 900}, text = "$800K + x2 код"},
    {money = 3000000,  rebirth = 1, text = "$3M + ребёрт"},
}

-- Сундук за время в игре: каждые N секунд можно забрать награду.
Config.PLAYTIME_CHEST = {every = 480, money = 4000, growth = 1.8}

--========================================================================
--  6. КОЛЕСО УДАЧИ
--  Бесплатный прокрут раз в 15 минут + платный за Robux (продукт WheelSpin).
--  weight — шанс (чем больше, тем чаще выпадает).
--========================================================================
Config.WHEEL_FREE_EVERY = 900
Config.WHEEL = {
    {weight = 26, kind = "money", value = 3000,  text = "$3K",            color = Color3.fromRGB(90, 200, 110)},
    {weight = 22, kind = "money", value = 12000, text = "$12K",           color = Color3.fromRGB(70, 180, 240)},
    {weight = 16, kind = "money", value = 45000, text = "$45K",           color = Color3.fromRGB(120, 140, 255)},
    {weight = 12, kind = "code",  value = 1.0,   text = "Полный рюкзак",  color = Color3.fromRGB(255, 190, 70)},
    {weight = 10, kind = "boost", value = {kind = "money", mult = 2, time = 600}, text = "x2 Деньги 10 мин", color = Color3.fromRGB(255, 120, 170)},
    {weight = 8,  kind = "boost", value = {kind = "code",  mult = 2, time = 600}, text = "x2 Код 10 мин",    color = Color3.fromRGB(0, 220, 200)},
    {weight = 5,  kind = "money", value = 400000, text = "$400K",         color = Color3.fromRGB(255, 96, 96)},
    {weight = 1,  kind = "rebirth", value = 1,   text = "РЕБЁРТ!",        color = Color3.fromRGB(220, 120, 255)},
}

--========================================================================
--  7. КОДЫ (раздавай в описании игры, в TikTok и в группе)
--  Игрок вводит код в меню "КОД" и получает награду один раз.
--========================================================================
Config.CODES = {
    ["СТАРТ"]    = {money = 10000,  text = "$10K на старт"},
    ["РЕЛИЗ"]    = {money = 50000,  text = "$50K за релиз"},
    ["ПОДПИСКА"] = {boost = {kind = "money", mult = 2, time = 900}, text = "x2 деньги на 15 минут"},
    ["67"]       = {money = 67000,  text = "$67K"},
    ["ТИКТОК"]   = {boost = {kind = "code", mult = 2, time = 900}, text = "x2 кода на 15 минут"},
}

--========================================================================
--  8. ГРУППА И ССЫЛКИ (для кнопок в меню)
--========================================================================
Config.GROUP_ID = 0             -- ID твоей Roblox-группы (0 = кнопка скрыта)
Config.GROUP_REWARD = {money = 15000, text = "$15K за вступление в группу"}

--========================================================================
--  9. КАРТИНКИ-ИКОНКИ (по желанию)
--  Залей PNG в Creator Hub -> Images, скопируй assetId и впиши сюда
--  в виде "rbxassetid://1234567890". Пусто = будет эмодзи.
--========================================================================
Config.ICONS = {
    Backpack = "",   -- 🎒 рюкзак
    Laptop   = "",   -- 💻 компьютер
    Money    = "",   -- 📈 цена продажи
}

--========================================================================
--  10. ЗВУК (по желанию)
--  Впиши свои rbxassetid, если хочешь музыку и звуки. Пусто = без звука.
--========================================================================
Config.SOUNDS = {
    music   = "",   -- фоновая музыка
    click   = "",   -- звук клика
    sell    = "",   -- звук продажи
    reward  = "",   -- звук награды
}

return Config
