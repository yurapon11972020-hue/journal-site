--========================================================================
--  MapBuilder — СЮЖЕТНАЯ КАРТА "СИМУЛЯТОР РАЗРАБОТЧИКА"
--
--  Путь героя слева направо, каждый остров — своя эпоха карьеры:
--    1. Гараж 2009        — дом, велик, старый ЭЛТ-монитор, коробки пиццы
--    2. Стартап-офис      — стекло, бинбэги, кофемашина, доска со стикерами
--    3. IT-кампус         — корпуса, купол, фонтан, серверные, дроны
--    4. Кремниевая долина — золотые башни, бассейн, вертолёт, пальмы
--    5. Космо-штаб        — станция, ракета, планета, спутники, ИИ-ядро
--  Острова висят в небе и соединены мостами; закрытые зоны перекрыты
--  силовым полем с табличкой требований.
--
--  Модуль НЕ знает игровых правил: все нажатия отдаёт наружу через ctx.
--  Лежит в ReplicatedStorage > DevSim > MapBuilder
--========================================================================

local Workspace = game:GetService("Workspace")

local Config = require(script.Parent.Config)
local Kit    = require(script.Parent.MapKit)

local Builder = {}

local ISLAND = Config.ISLAND
local HALF   = ISLAND / 2
local FLOOR  = 3                -- уровень, по которому ходят игроки

--========================== ГЕОМЕТРИЯ ==================================

function Builder.zoneCenter(i)
    return Vector3.new((i - 1) * Config.ZONE_GAP, 0, 0)
end

function Builder.zoneSpawn(i)
    return Builder.zoneCenter(i) + Vector3.new(0, 9, 30)
end

function Builder.zoneFromPosition(pos)
    local i = math.floor(pos.X / Config.ZONE_GAP + 0.5) + 1
    return math.clamp(i, 1, #Config.ZONES)
end

Builder.VIP_CENTER = Vector3.new(Config.ZONE_GAP * 1.5, 210, -300)

--========================== ОБЩИЕ ЭЛЕМЕНТЫ =============================

local function plaza(c, folder, pal)
    local tile = 26
    for gx = -1, 1 do
        for gz = -1, 1 do
            local light = ((gx + gz) % 2 == 0)
            Kit.deco({
                Name = "PlazaTile",
                Size = Vector3.new(tile, 0.7, tile),
                Position = c + Vector3.new(gx * tile, FLOOR + 0.2, gz * tile),
                Color = light and Color3.fromRGB(236, 232, 220) or pal.ground2,
                Material = Enum.Material.Concrete,
            }, folder)
        end
    end
    local ring = Kit.disc(c + Vector3.new(0, FLOOR + 0.7, 0), 22, 0.4, pal.accent, folder, Enum.Material.Neon)
    Kit.markSpin(ring, 0.35, "X")
end

local function scatterCoins(c, folder, spots)
    for _, s in ipairs(spots) do
        Kit.coin(c + s, folder)
    end
end

--========================== ЗОНА 1: ГАРАЖ ==============================

local function decorGarage(c, folder, pal)
    -- жилой дом с гаражом
    Kit.building({
        pos = c + Vector3.new(-74, 0, -62), width = 46, height = 24, depth = 30,
        wall = pal.wall, roof = pal.roof, accent = pal.accent,
        roofStyle = "gable", windowRows = 1, windowCols = 2,
        title = "ДОМ РОДИТЕЛЕЙ",
    }, folder)

    -- сам гараж: пристройка с полосатыми воротами
    Kit.part({Name = "GarageWall", Size = Vector3.new(30, 18, 26), Position = c + Vector3.new(-40, 12, -62), Color = pal.wall}, folder)
    Kit.part({Name = "GarageRoof", Size = Vector3.new(33, 2.4, 29), Position = c + Vector3.new(-40, 22, -62), Color = pal.roof}, folder)
    for k = 0, 6 do
        Kit.deco({
            Name = "GateSlat",
            Size = Vector3.new(22, 2, 0.8),
            Position = c + Vector3.new(-40, 5 + k * 2.2, -76.6),
            Color = (k % 2 == 0) and Color3.fromRGB(228, 226, 220) or Color3.fromRGB(196, 90, 74),
        }, folder)
    end
    Kit.deco({Name = "GarageLamp", Size = Vector3.new(4, 1.4, 2), Position = c + Vector3.new(-40, 21, -76.4), Color = Color3.fromRGB(255, 232, 170), Material = Enum.Material.Neon}, folder)

    -- подъездная дорожка, почтовый ящик, забор
    Kit.path(c + Vector3.new(-40, 0, -30), 16, 60, folder, Color3.fromRGB(200, 196, 188))
    Kit.pillar(c + Vector3.new(-16, FLOOR + 5, -30), 1.6, 10, Color3.fromRGB(120, 84, 58), folder)
    Kit.deco({Name = "Mailbox", Size = Vector3.new(4.5, 3.4, 3), Position = c + Vector3.new(-16, FLOOR + 11, -30), Color = pal.accent, Material = Enum.Material.Metal}, folder)
    Kit.fence(c, HALF, Color3.fromRGB(244, 240, 228), folder, 24)

    -- велосипед у стены
    Kit.disc(c + Vector3.new(-24, FLOOR + 4, -70), 8, 1, Color3.fromRGB(38, 40, 48), folder, Enum.Material.Metal)
    Kit.disc(c + Vector3.new(-16, FLOOR + 4, -70), 8, 1, Color3.fromRGB(38, 40, 48), folder, Enum.Material.Metal)
    Kit.deco({Name = "BikeFrame", Size = Vector3.new(9, 1, 0.8), Position = c + Vector3.new(-20, FLOOR + 6, -70), Color = Color3.fromRGB(220, 80, 90), Material = Enum.Material.Metal}, folder)

    -- баскетбольное кольцо
    Kit.pillar(c + Vector3.new(60, FLOOR + 11, -70), 2.2, 22, Color3.fromRGB(70, 74, 88), folder, Enum.Material.Metal)
    Kit.deco({Name = "Backboard", Size = Vector3.new(12, 8, 0.8), Position = c + Vector3.new(60, FLOOR + 23, -68), Color = Color3.fromRGB(246, 246, 240)}, folder)
    Kit.disc(c + Vector3.new(60, FLOOR + 19, -65.5), 6, 0.6, Color3.fromRGB(240, 110, 50), folder, Enum.Material.Metal)

    -- стопка коробок из-под пиццы (символ ночного кодинга)
    for k = 0, 4 do
        Kit.deco({
            Name = "PizzaBox",
            Size = Vector3.new(9, 1.6, 9),
            Position = c + Vector3.new(22, FLOOR + 1 + k * 1.7, -48),
            Color = (k % 2 == 0) and Color3.fromRGB(232, 216, 178) or Color3.fromRGB(214, 196, 156),
        }, folder)
    end

    -- качели и садик
    Kit.pillar(c + Vector3.new(-92, FLOOR + 9, 40), 2, 18, Color3.fromRGB(120, 84, 58), folder)
    Kit.pillar(c + Vector3.new(-72, FLOOR + 9, 40), 2, 18, Color3.fromRGB(120, 84, 58), folder)
    Kit.deco({Name = "SwingBar", Size = Vector3.new(22, 1.6, 1.6), Position = c + Vector3.new(-82, FLOOR + 18, 40), Color = Color3.fromRGB(120, 84, 58)}, folder)
    local seat = Kit.deco({Name = "Swing", Size = Vector3.new(7, 0.8, 3), Position = c + Vector3.new(-82, FLOOR + 8, 40), Color = Color3.fromRGB(200, 120, 60)}, folder)
    Kit.markBob(seat, 1.2, 1.4)

    for _, p in ipairs({Vector3.new(-118, 3, 96), Vector3.new(104, 3, 82), Vector3.new(112, 3, -104), Vector3.new(-116, 3, -20), Vector3.new(76, 3, 118)}) do
        Kit.tree(c + p, folder, "oak")
    end
    Kit.bush(c + Vector3.new(-60, 3, 84), pal.ground, folder)
    Kit.bush(c + Vector3.new(64, 3, 96), pal.ground, folder)
    Kit.flowers(c + Vector3.new(-30, FLOOR, 100), Color3.fromRGB(255, 130, 150), folder)
    Kit.flowers(c + Vector3.new(34, FLOOR, 104), Color3.fromRGB(255, 214, 96), folder)
    Kit.rock(c + Vector3.new(118, 3, 30), folder)
end

--========================== ЗОНА 2: СТАРТАП ============================

local function decorStartup(c, folder, pal)
    -- стеклянный опенспейс
    Kit.building({
        pos = c + Vector3.new(-70, 0, -60), width = 60, height = 30, depth = 34,
        wall = pal.wall, roof = pal.roof, accent = pal.accent, glass = Color3.fromRGB(150, 220, 255),
        windowRows = 2, windowCols = 4, title = "STARTUP HQ",
    }, folder)
    for k = 0, 3 do
        Kit.glass({Name = "GlassWall", Size = Vector3.new(14, 26, 0.6), Position = c + Vector3.new(-96 + k * 16, 17, -42.6), Color = Color3.fromRGB(180, 226, 255)}, folder)
    end

    -- неоновая вывеска на крыше
    local neonSign = Kit.deco({Name = "NeonSign", Size = Vector3.new(34, 8, 1), Position = c + Vector3.new(-70, 42, -60), Color = pal.accent, Material = Enum.Material.Neon}, folder)
    Kit.surfaceText(neonSign, "МЫ НАНИМАЕМ", Color3.new(1, 1, 1), Enum.NormalId.Front, 520, 120)
    Kit.markPulse(neonSign, 0.8)

    -- кофемашина и кулер
    Kit.part({Name = "CoffeeMachine", Size = Vector3.new(7, 11, 6), Position = c + Vector3.new(-24, FLOOR + 5.5, -34), Color = Color3.fromRGB(48, 52, 64), Material = Enum.Material.Metal}, folder)
    Kit.deco({Name = "CoffeeGlow", Size = Vector3.new(5, 2, 0.6), Position = c + Vector3.new(-24, FLOOR + 8, -37.2), Color = Color3.fromRGB(255, 170, 70), Material = Enum.Material.Neon}, folder)
    Kit.billboard(Kit.deco({Name = "CoffeeTag", Size = Vector3.new(1, 1, 1), Position = c + Vector3.new(-24, FLOOR + 13, -34), Transparency = 1}, folder), "☕ БЕСКОНЕЧНЫЙ КОФЕ", pal.accent, 260, 0)
    Kit.pillar(c + Vector3.new(-14, FLOOR + 6, -34), 4, 12, Color3.fromRGB(226, 240, 255), folder)

    -- доска со стикерами
    Kit.deco({Name = "Board", Size = Vector3.new(26, 16, 1), Position = c + Vector3.new(30, FLOOR + 12, -40), Color = Color3.fromRGB(250, 250, 246)}, folder)
    Kit.pillar(c + Vector3.new(18, FLOOR + 2, -40), 1.4, 4, Color3.fromRGB(80, 84, 96), folder, Enum.Material.Metal)
    Kit.pillar(c + Vector3.new(42, FLOOR + 2, -40), 1.4, 4, Color3.fromRGB(80, 84, 96), folder, Enum.Material.Metal)
    local stickers = {Color3.fromRGB(255, 214, 90), Color3.fromRGB(120, 230, 160), Color3.fromRGB(255, 140, 170), Color3.fromRGB(130, 190, 255)}
    for k = 0, 7 do
        Kit.deco({
            Name = "Sticker",
            Size = Vector3.new(4.4, 4.4, 0.3),
            Position = c + Vector3.new(21 + (k % 4) * 6, FLOOR + 9 + math.floor(k / 4) * 6, -40.7),
            Color = stickers[(k % #stickers) + 1],
        }, folder)
    end

    -- бинбэги и пинг-понг
    for _, p in ipairs({Vector3.new(-40, 0, 40), Vector3.new(-28, 0, 52), Vector3.new(-52, 0, 54)}) do
        local bag = Kit.ball({Name = "BeanBag", Size = Vector3.new(9, 6, 9), Position = c + p + Vector3.new(0, FLOOR + 2.6, 0), Color = Color3.fromRGB(90, 150, 240), CanCollide = false}, folder)
        Kit.markBob(bag, 0.35, 0.8)
    end
    Kit.part({Name = "PingPong", Size = Vector3.new(20, 1.2, 11), Position = c + Vector3.new(66, FLOOR + 6, 44), Color = Color3.fromRGB(40, 110, 190)}, folder)
    Kit.deco({Name = "Net", Size = Vector3.new(0.5, 2.4, 11), Position = c + Vector3.new(66, FLOOR + 7.6, 44), Color = Color3.fromRGB(240, 240, 240)}, folder)
    for _, dx in ipairs({-9, 9}) do
        Kit.deco({Name = "TableLeg", Size = Vector3.new(1.2, 6, 9), Position = c + Vector3.new(66 + dx, FLOOR + 3, 44), Color = Color3.fromRGB(60, 64, 78)}, folder)
    end

    -- растения в горшках + фикусы
    for _, p in ipairs({Vector3.new(-100, 0, 20), Vector3.new(100, 0, -20), Vector3.new(-10, 0, -96), Vector3.new(96, 0, 100)}) do
        Kit.part({Name = "Pot", Size = Vector3.new(7, 6, 7), Position = c + p + Vector3.new(0, FLOOR + 3, 0), Color = Color3.fromRGB(224, 216, 202)}, folder)
        Kit.ball({Name = "Plant", Size = Vector3.new(11, 11, 11), Position = c + p + Vector3.new(0, FLOOR + 10, 0), Color = Color3.fromRGB(96, 190, 120), Material = Enum.Material.Grass, CanCollide = false}, folder)
    end

    -- стеклянные перила по краю крыши мира
    for _, s in ipairs({1, -1}) do
        Kit.glass({Name = "Railing", Size = Vector3.new(ISLAND - 20, 7, 0.6), Position = c + Vector3.new(0, FLOOR + 4.5, s * (HALF - 6)), Color = Color3.fromRGB(190, 230, 255)}, folder)
    end
end

--========================== ЗОНА 3: КАМПУС =============================

local function decorCampus(c, folder, pal)
    -- три корпуса
    Kit.building({pos = c + Vector3.new(-86, 0, -56), width = 40, height = 26, depth = 26, wall = pal.wall, roof = pal.roof, accent = pal.accent, windowRows = 2, windowCols = 3, title = "КОРПУС A"}, folder)
    Kit.building({pos = c + Vector3.new(86, 0, -56), width = 40, height = 26, depth = 26, wall = pal.wall, roof = pal.roof, accent = pal.accent, windowRows = 2, windowCols = 3, title = "КОРПУС B"}, folder)
    Kit.building({pos = c + Vector3.new(0, 0, -132), width = 54, height = 22, depth = 22, wall = pal.wall, roof = pal.roof, accent = pal.accent, windowRows = 1, windowCols = 4, title = "ЛАБОРАТОРИЯ"}, folder)

    -- стеклянный купол над двором
    local dome = Kit.ball({Name = "Dome", Size = Vector3.new(70, 70, 70), Position = c + Vector3.new(0, FLOOR - 8, 78), Color = Color3.fromRGB(196, 240, 255), CanCollide = false}, folder)
    dome.Material = Enum.Material.Glass
    dome.Transparency = 0.72
    Kit.disc(c + Vector3.new(0, FLOOR + 1, 78), 74, 1.4, pal.accent, folder, Enum.Material.Neon)

    -- фонтан
    Kit.disc(c + Vector3.new(-60, FLOOR + 1.2, 60), 30, 2, Color3.fromRGB(230, 232, 236), folder, Enum.Material.Concrete)
    Kit.disc(c + Vector3.new(-60, FLOOR + 2.2, 60), 24, 1, Color3.fromRGB(96, 200, 255), folder, Enum.Material.Neon)
    Kit.pillar(c + Vector3.new(-60, FLOOR + 7, 60), 4, 10, Color3.fromRGB(230, 232, 236), folder)
    local jet = Kit.ball({Name = "Jet", Size = Vector3.new(6, 6, 6), Position = c + Vector3.new(-60, FLOOR + 13, 60), Color = Color3.fromRGB(140, 220, 255), Material = Enum.Material.Neon, CanCollide = false}, folder)
    Kit.emit(jet, Color3.fromRGB(150, 225, 255), 30, 1.6, 8, 2.2)
    Kit.markBob(jet, 0.8, 2.2)

    -- солнечные панели
    for k = 0, 3 do
        local panel = Kit.deco({Name = "SolarPanel", Size = Vector3.new(18, 0.8, 11), Color = Color3.fromRGB(46, 62, 110), Material = Enum.Material.Metal}, folder)
        panel.CFrame = CFrame.new(c + Vector3.new(70 + k * 22, FLOOR + 8, 60)) * CFrame.Angles(math.rad(-28), 0, 0)
        Kit.pillar(c + Vector3.new(70 + k * 22, FLOOR + 4, 60), 1.6, 8, Color3.fromRGB(90, 96, 110), folder, Enum.Material.Metal)
    end

    -- серверная стена
    for k = 0, 4 do
        Kit.serverRack(c + Vector3.new(-116 + k * 10, FLOOR, -8), pal.accent, folder)
    end

    -- дроны кружат над двором
    for k = 1, 4 do
        local drone = Kit.deco({Name = "Drone", Size = Vector3.new(4.5, 1.4, 4.5), Position = c + Vector3.new(0, 46, 0), Color = Color3.fromRGB(240, 244, 250), Material = Enum.Material.Metal}, folder)
        Kit.light(drone, pal.accent, 12, 1.4)
        Kit.emit(drone, pal.accent, 6, 0.6, 1, 1)
        Kit.markOrbit(drone, c + Vector3.new(0, 48, 20), 56 + k * 9, 0.35 + k * 0.08, 4)
        drone:SetAttribute("OrbitPhase", k * 1.57)
    end

    -- флагшток и скамейки
    Kit.pillar(c + Vector3.new(58, FLOOR + 16, -10), 1.8, 32, Color3.fromRGB(230, 232, 238), folder, Enum.Material.Metal)
    local flag = Kit.deco({Name = "Flag", Size = Vector3.new(14, 8, 0.4), Position = c + Vector3.new(65, FLOOR + 28, -10), Color = pal.accent, Material = Enum.Material.Neon}, folder)
    Kit.surfaceText(flag, "DEV", Color3.new(1, 1, 1), Enum.NormalId.Front, 200, 120)
    Kit.markBob(flag, 0.6, 1.6)

    Kit.bench(c + Vector3.new(-30, FLOOR, 96), folder)
    Kit.bench(c + Vector3.new(30, FLOOR, 96), folder)
    for _, p in ipairs({Vector3.new(-120, 3, 118), Vector3.new(120, 3, 118), Vector3.new(-120, 3, -118), Vector3.new(120, 3, -118)}) do
        Kit.tree(c + p, folder, "pine", Color3.fromRGB(70, 160, 100))
    end
    Kit.path(c + Vector3.new(0, 0, 40), 18, 200, folder, Color3.fromRGB(224, 230, 224))
end

--========================== ЗОНА 4: ДОЛИНА =============================

local function decorValley(c, folder, pal)
    Kit.tower(c + Vector3.new(-92, 0, -70), 5, pal.wall, pal.accent, folder, "IPO")
    Kit.tower(c + Vector3.new(-46, 0, -114), 4, Color3.fromRGB(244, 232, 206), pal.accent, folder)
    Kit.tower(c + Vector3.new(96, 0, -78), 6, pal.wall, Color3.fromRGB(255, 168, 60), folder, "UNICORN")

    -- бассейн с подсветкой
    Kit.part({Name = "PoolEdge", Size = Vector3.new(64, 2, 40), Position = c + Vector3.new(-70, FLOOR + 0.6, 66), Color = Color3.fromRGB(248, 242, 226), Material = Enum.Material.Concrete}, folder)
    local water = Kit.deco({Name = "PoolWater", Size = Vector3.new(58, 1.6, 34), Position = c + Vector3.new(-70, FLOOR + 1.6, 66), Color = Color3.fromRGB(80, 200, 250), Material = Enum.Material.Neon, Transparency = 0.3}, folder)
    Kit.light(water, Color3.fromRGB(90, 210, 255), 30, 1.6)
    for _, p in ipairs({Vector3.new(-104, 0, 40), Vector3.new(-36, 0, 40), Vector3.new(-104, 0, 92), Vector3.new(-36, 0, 92)}) do
        Kit.tree(c + p, folder, "palm")
    end

    -- вертолётная площадка
    Kit.disc(c + Vector3.new(74, FLOOR + 1, 70), 46, 2, Color3.fromRGB(60, 64, 78), folder, Enum.Material.Concrete)
    Kit.disc(c + Vector3.new(74, FLOOR + 2.2, 70), 40, 0.6, Color3.fromRGB(255, 210, 90), folder, Enum.Material.Neon)
    local hMark = Kit.deco({Name = "HeliH", Size = Vector3.new(16, 0.4, 4), Position = c + Vector3.new(74, FLOOR + 3, 70), Color = Color3.fromRGB(30, 32, 40)}, folder)
    Kit.deco({Name = "HeliH", Size = Vector3.new(4, 0.4, 16), Position = c + Vector3.new(66, FLOOR + 3, 70), Color = Color3.fromRGB(30, 32, 40)}, folder)
    Kit.deco({Name = "HeliH", Size = Vector3.new(4, 0.4, 16), Position = c + Vector3.new(82, FLOOR + 3, 70), Color = Color3.fromRGB(30, 32, 40)}, folder)

    -- вертолёт кружит над башнями
    local heli = Kit.deco({Name = "Heli", Size = Vector3.new(8, 6, 16), Position = c + Vector3.new(0, 90, 0), Color = Color3.fromRGB(38, 42, 54), Material = Enum.Material.Metal}, folder)
    Kit.markOrbit(heli, c + Vector3.new(0, 96, -40), 120, 0.22, 6)
    local rotor = Kit.deco({Name = "Rotor", Size = Vector3.new(26, 0.6, 2.4), Position = c + Vector3.new(0, 96, 0), Color = Color3.fromRGB(60, 64, 78)}, folder)
    Kit.markSpin(rotor, 14, "Y")

    -- спорткар у подъезда
    Kit.part({Name = "CarBody", Size = Vector3.new(20, 5, 9), Position = c + Vector3.new(36, FLOOR + 4, -30), Color = Color3.fromRGB(230, 60, 70), Material = Enum.Material.Metal}, folder)
    Kit.wedge({Name = "CarHood", Size = Vector3.new(9, 4, 7), CFrame = CFrame.new(c + Vector3.new(28, FLOOR + 8.5, -30)) * CFrame.Angles(0, math.rad(-90), 0), Color = Color3.fromRGB(230, 60, 70), Material = Enum.Material.Metal}, folder)
    Kit.glass({Name = "CarGlass", Size = Vector3.new(8, 4, 8.4), Position = c + Vector3.new(38, FLOOR + 8.5, -30), Color = Color3.fromRGB(180, 220, 255)}, folder)
    for _, off in ipairs({Vector3.new(-7, 0, 4.6), Vector3.new(7, 0, 4.6), Vector3.new(-7, 0, -4.6), Vector3.new(7, 0, -4.6)}) do
        local wheel = Kit.disc(c + Vector3.new(36, FLOOR + 3, -30) + off, 7, 2.4, Color3.fromRGB(28, 30, 36), folder, Enum.Material.Metal)
        wheel.CFrame = CFrame.new(c + Vector3.new(36, FLOOR + 3, -30) + off) * CFrame.Angles(math.rad(90), 0, math.rad(90))
    end

    -- фонтан из денег: монетки летят вверх
    local moneyFountain = Kit.disc(c + Vector3.new(0, FLOOR + 2, 112), 26, 2, Color3.fromRGB(255, 214, 96), folder, Enum.Material.Neon)
    Kit.emit(moneyFountain, Color3.fromRGB(255, 220, 110), 26, 2, 14, 2.6)
    Kit.billboard(moneyFountain, "💸 ФОНТАН МИЛЛИОНОВ", Color3.fromRGB(255, 214, 96), 300, 8)

    -- золотые статуи-кубки
    for _, dx in ipairs({-24, 24}) do
        Kit.pillar(c + Vector3.new(dx, FLOOR + 6, -46), 8, 12, Color3.fromRGB(250, 236, 200), folder)
        local cup = Kit.ball({Name = "Trophy", Size = Vector3.new(10, 10, 10), Position = c + Vector3.new(dx, FLOOR + 17, -46), Color = Color3.fromRGB(255, 206, 70), Material = Enum.Material.Neon, CanCollide = false}, folder)
        Kit.markBob(cup, 1, 1.1)
        Kit.light(cup, Color3.fromRGB(255, 206, 70), 20, 2)
    end
end

--========================== ЗОНА 5: КОСМОС =============================

local function decorSpace(c, folder, pal)
    -- металлическая палуба поверх острова
    Kit.deco({Name = "Deck", Size = Vector3.new(ISLAND - 10, 1.4, ISLAND - 10), Position = c + Vector3.new(0, FLOOR + 0.4, 0), Color = Color3.fromRGB(66, 70, 96), Material = Enum.Material.DiamondPlate}, folder)
    for k = -2, 2 do
        Kit.deco({Name = "DeckStripe", Size = Vector3.new(ISLAND - 20, 0.4, 2.5), Position = c + Vector3.new(0, FLOOR + 1.2, k * 44), Color = pal.trim, Material = Enum.Material.Neon}, folder)
    end

    -- главный модуль станции
    Kit.building({
        pos = c + Vector3.new(-80, 0, -60), width = 52, height = 28, depth = 30,
        wall = pal.wall, roof = pal.roof, accent = pal.accent, glass = pal.trim,
        windowRows = 2, windowCols = 3, title = "ЦЕНТР УПРАВЛЕНИЯ",
    }, folder)

    -- ракета на стартовом столе
    local rx = c + Vector3.new(92, 0, -50)
    Kit.disc(rx + Vector3.new(0, FLOOR + 1, 0), 40, 2, Color3.fromRGB(52, 56, 76), folder, Enum.Material.Metal)
    Kit.pillar(rx + Vector3.new(0, FLOOR + 34, 0), 16, 62, Color3.fromRGB(238, 242, 250), folder, Enum.Material.Metal)
    Kit.deco({Name = "RocketBand", Size = Vector3.new(17, 4, 17), Position = rx + Vector3.new(0, FLOOR + 44, 0), Color = Color3.fromRGB(230, 70, 80)}, folder)
    local nose = Kit.ball({Name = "RocketNose", Size = Vector3.new(16, 20, 16), Position = rx + Vector3.new(0, FLOOR + 70, 0), Color = Color3.fromRGB(230, 70, 80), CanCollide = false}, folder)
    for a = 0, 3 do
        local fin = Kit.wedge({Name = "Fin", Size = Vector3.new(2, 12, 10), Color = Color3.fromRGB(230, 70, 80)}, folder)
        fin.CFrame = CFrame.new(rx + Vector3.new(0, FLOOR + 10, 0)) * CFrame.Angles(0, math.rad(a * 90), 0) * CFrame.new(0, 0, -11)
    end
    local flame = Kit.ball({Name = "Flame", Size = Vector3.new(13, 10, 13), Position = rx + Vector3.new(0, FLOOR + 2, 0), Color = Color3.fromRGB(255, 170, 60), Material = Enum.Material.Neon, CanCollide = false}, folder)
    Kit.emit(flame, Color3.fromRGB(255, 170, 60), 40, 3, 12, 1.6)
    Kit.markPulse(flame, 3)
    -- ферма обслуживания
    for k = 0, 4 do
        Kit.deco({Name = "TowerRing", Size = Vector3.new(26, 1.2, 3), Position = rx + Vector3.new(-14, FLOOR + 8 + k * 14, 0), Color = Color3.fromRGB(120, 126, 148), Material = Enum.Material.Metal}, folder)
    end
    Kit.pillar(rx + Vector3.new(-26, FLOOR + 36, 0), 3, 68, Color3.fromRGB(120, 126, 148), folder, Enum.Material.Metal)

    -- планета внизу + спутники
    local planet = Kit.ball({Name = "Planet", Size = Vector3.new(420, 420, 420), Position = c + Vector3.new(-40, -520, 260), Color = Color3.fromRGB(70, 120, 220), CanCollide = false}, folder)
    planet.Material = Enum.Material.SmoothPlastic
    Kit.ball({Name = "PlanetCloud", Size = Vector3.new(432, 432, 432), Position = c + Vector3.new(-40, -520, 260), Color = Color3.fromRGB(240, 248, 255), Transparency = 0.72, CanCollide = false}, folder)
    for k = 1, 3 do
        local sat = Kit.deco({Name = "Satellite", Size = Vector3.new(6, 3, 6), Position = c + Vector3.new(0, 120, 0), Color = Color3.fromRGB(226, 230, 240), Material = Enum.Material.Metal}, folder)
        Kit.deco({Name = "SatPanel", Size = Vector3.new(16, 0.6, 5), Position = c + Vector3.new(0, 120, 0), Color = Color3.fromRGB(60, 90, 190), Material = Enum.Material.Neon}, folder)
        Kit.markOrbit(sat, c + Vector3.new(0, 110 + k * 16, 0), 150 + k * 24, 0.18 + k * 0.05, 8)
        sat:SetAttribute("OrbitPhase", k * 2.1)
    end

    -- ИИ-ядро в кольцах
    local core = Kit.ball({Name = "AICore", Size = Vector3.new(20, 20, 20), Position = c + Vector3.new(-60, FLOOR + 24, 70), Color = pal.accent, Material = Enum.Material.Neon, CanCollide = false}, folder)
    Kit.light(core, pal.accent, 42, 3)
    Kit.markPulse(core, 1.1)
    Kit.emit(core, pal.accent, 20, 1.6, 3, 2)
    Kit.holoRing(c + Vector3.new(-60, FLOOR + 24, 70), 40, pal.trim, folder, 1.4)
    Kit.holoRing(c + Vector3.new(-60, FLOOR + 24, 70), 54, pal.accent, folder, 1)
    Kit.billboard(core, "🧠 ИИ-ЯДРО", pal.accent, 240, 14)

    -- голограммы кода вокруг палубы
    for k = 0, 5 do
        local ang = math.rad(k * 60)
        local pos = c + Vector3.new(math.cos(ang) * 110, FLOOR + 16, math.sin(ang) * 110)
        local holo = Kit.deco({Name = "Holo", Size = Vector3.new(10, 12, 0.4), Position = pos, Color = pal.trim, Material = Enum.Material.Neon, Transparency = 0.35}, folder)
        Kit.surfaceText(holo, "</>", Color3.new(1, 1, 1), Enum.NormalId.Front, 200, 200)
        Kit.markSpin(holo, 0.6, "Y")
        Kit.pillar(pos + Vector3.new(0, -10, 0), 2, 10, Color3.fromRGB(80, 86, 110), folder, Enum.Material.Metal)
    end

    -- звёздная пыль
    for k = 1, 14 do
        local star = Kit.ball({
            Name = "Star",
            Size = Vector3.new(2.4, 2.4, 2.4),
            Position = c + Vector3.new(math.random(-160, 160), math.random(40, 140), math.random(-160, 160)),
            Color = Color3.fromRGB(240, 240, 255),
            Material = Enum.Material.Neon,
            CanCollide = false,
        }, folder)
        Kit.markBob(star, 3, 0.5 + k * 0.05)
    end
end

local DECOR = {decorGarage, decorStartup, decorCampus, decorValley, decorSpace}

--========================== СБОРКА ЗОНЫ ================================

local function buildZone(i, ctx, root)
    local zone = Config.ZONES[i]
    local pal = zone.palette
    local c = Builder.zoneCenter(i)
    local folder = Instance.new("Folder")
    folder.Name = "Zone_" .. i
    folder:SetAttribute("ZoneIndex", i)

    Kit.floatingIsland(c, ISLAND, pal, folder, 0, {
        west = (i > 1),
        east = (i < #Config.ZONES),
    })
    plaza(c, folder, pal)

    -- главная вывеска зоны
    Kit.signBoard(c + Vector3.new(0, FLOOR, -HALF + 34), zone.name .. "  x" .. zone.mult, pal.accent, 52, folder, zone.story)

    -- рабочее место (клик)
    local screen = Kit.workstation(c + Vector3.new(0, FLOOR, -64), {
        accent = pal.accent,
        desk = (i >= 4) and Color3.fromRGB(60, 64, 82) or Color3.fromRGB(150, 100, 60),
        deskMaterial = (i >= 4) and Enum.Material.Metal or Enum.Material.WoodPlanks,
        screenText = "</>",
    }, folder)
    Kit.billboard(screen, "💻 ПИСАТЬ КОД  (E)", pal.accent, 270, 6)
    -- по монитору можно кликать мышкой; клавишу E ловит интерфейс,
    -- поэтому отдельного ProximityPrompt тут нет (иначе код капал бы дважды)
    local cd = Instance.new("ClickDetector")
    cd.MaxActivationDistance = 34
    cd.Parent = screen
    cd.MouseClick:Connect(function(plr) ctx.onClick(plr) end)

    -- пад продажи
    local sellPad = Kit.pad(c + Vector3.new(0, FLOOR + 1.2, 72), 26, Color3.fromRGB(70, 215, 100), "💰 ПРОДАТЬ КОД", folder, 280)
    sellPad.Name = "SellPad_" .. i
    Kit.arch(c + Vector3.new(0, FLOOR, 72), 48, 24, "ПРОДАЖА КОДА", Color3.fromRGB(60, 190, 90), folder)
    local sellDeb = {}
    sellPad.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if not plr then return end
        if sellDeb[plr] and os.clock() - sellDeb[plr] < 0.7 then return end
        sellDeb[plr] = os.clock()
        ctx.onSell(plr, i)
    end)

    -- стенды: магазин и ребёрт
    local shopPrompt = Kit.stand(c + Vector3.new(-56, FLOOR, 6), {
        name = "ShopStand", icon = "🛒", title = "МАГАЗИН", action = "Открыть", color = Color3.fromRGB(0, 190, 240),
    }, folder)
    shopPrompt.Triggered:Connect(function(plr) ctx.onShop(plr) end)

    local rebirthPrompt = Kit.stand(c + Vector3.new(56, FLOOR, 6), {
        name = "RebirthStand", icon = "🌟", title = "РЕБЁРТ", action = "Открыть", color = Color3.fromRGB(190, 110, 255),
    }, folder)
    rebirthPrompt.Triggered:Connect(function(plr) ctx.onRebirth(plr) end)

    -- фонари по углам
    for _, s in ipairs({{1, 1}, {1, -1}, {-1, 1}, {-1, -1}}) do
        Kit.lamp(c + Vector3.new(s[1] * (HALF - 16), FLOOR, s[2] * (HALF - 16)), pal.accent, folder)
    end

    -- облака только в атмосфере
    if i < 5 then
        Kit.cloud(c + Vector3.new(-70, 78, -40), folder)
        Kit.cloud(c + Vector3.new(80, 92, 40), folder)
        Kit.cloud(c + Vector3.new(10, 104, 110), folder)
    end

    scatterCoins(c, folder, {
        Vector3.new(-34, FLOOR + 6, 34), Vector3.new(34, FLOOR + 6, 34),
        Vector3.new(-34, FLOOR + 6, -18), Vector3.new(34, FLOOR + 6, -18),
    })

    DECOR[i](c, folder, pal)

    folder.Parent = root
    return folder
end

--========================== МОСТЫ И ВОРОТА =============================

local function buildBridge(i, ctx, root)
    local a = Builder.zoneCenter(i) + Vector3.new(HALF, FLOOR - 0.8, 0)
    local b = Builder.zoneCenter(i + 1) + Vector3.new(-HALF, FLOOR - 0.8, 0)
    local folder = Instance.new("Folder")
    folder.Name = "Bridge_" .. i .. "_" .. (i + 1)

    local next_ = Config.ZONES[i + 1]
    Kit.bridge(a, b, next_.palette.accent, folder, 18)

    -- арки на въезде и выезде (развёрнуты поперёк моста)
    Kit.arch(a + Vector3.new(8, 0.8, 0), 30, 22, "▶ " .. next_.name, next_.palette.accent, folder, 90)
    Kit.arch(b - Vector3.new(8, -0.8, 0), 30, 22, "◀ " .. Config.ZONES[i].name, Config.ZONES[i].palette.accent, folder, 90)

    -- ворота: перекрывают путь, пока зона закрыта
    local need = "🔒 Нужно ребёртов: " .. next_.needRebirth
    if next_.needMoney > 0 then
        need = need .. "  или $" .. next_.needMoney
    end
    local gatePos = a:Lerp(b, 0.5)
    local field = Kit.gate(gatePos, next_.palette.accent, next_.name .. "\n" .. need, folder, 22, 90)
    field.Name = "Gate_" .. (i + 1)
    field:SetAttribute("ZoneIndex", i + 1)
    field.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if plr then ctx.onGateTouch(plr, i + 1) end
    end)

    -- быстрые пады "перепрыгнуть мост"
    local padA = Kit.pad(Builder.zoneCenter(i) + Vector3.new(HALF - 26, FLOOR + 1.2, 0), 14, next_.palette.accent, "▶ " .. next_.name, folder, 260)
    padA.Name = "Travel_" .. (i + 1)
    local padB = Kit.pad(Builder.zoneCenter(i + 1) + Vector3.new(-HALF + 26, FLOOR + 1.2, 0), 14, Config.ZONES[i].palette.accent, "◀ " .. Config.ZONES[i].name, folder, 260)
    padB.Name = "Travel_" .. i

    local deb = {}
    local function hookTravel(pad, target)
        pad.Touched:Connect(function(hit)
            local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
            if not plr then return end
            if deb[plr] and os.clock() - deb[plr] < 1.2 then return end
            deb[plr] = os.clock()
            ctx.onTravel(plr, target)
        end)
    end
    hookTravel(padA, i + 1)
    hookTravel(padB, i)

    folder.Parent = root
    return folder
end

--========================== ХАБ (ЗОНА 1) ===============================

local function buildBoard(pos, titleText, titleColor, parent)
    Kit.pillar(pos + Vector3.new(0, -14, 0), 4, 26, Color3.fromRGB(48, 52, 64), parent, Enum.Material.Metal)
    Kit.part({Name = "BoardBack", Size = Vector3.new(3, 28, 36), Position = pos, Color = titleColor, Material = Enum.Material.Neon}, parent)
    local board = Kit.part({Name = "Board", Size = Vector3.new(2.4, 26, 34), Position = pos + Vector3.new(0.6, 0, 0), Color = Color3.fromRGB(26, 28, 34)}, parent)

    local sg = Instance.new("SurfaceGui")
    sg.Face = Enum.NormalId.Right
    sg.Adornee = board
    sg.LightInfluence = 0
    sg.CanvasSize = Vector2.new(560, 820)
    sg.MaxDistance = 400
    sg.Parent = board

    local frame = Instance.new("Frame")
    frame.Size = UDim2.fromScale(1, 1)
    frame.BackgroundColor3 = Color3.fromRGB(22, 24, 30)
    frame.Parent = sg

    local title = Instance.new("TextLabel")
    title.Size = UDim2.new(1, 0, 0, 100)
    title.BackgroundTransparency = 1
    title.Text = titleText
    title.Font = Enum.Font.FredokaOne
    title.TextScaled = true
    title.TextColor3 = titleColor
    title.Parent = frame
    local ts = Instance.new("UIStroke")
    ts.Color = Color3.fromRGB(0, 0, 0)
    ts.Thickness = 2
    ts.Parent = title

    local list = Instance.new("TextLabel")
    list.Name = "List"
    list.Position = UDim2.new(0, 20, 0, 108)
    list.Size = UDim2.new(1, -40, 1, -120)
    list.BackgroundTransparency = 1
    list.TextXAlignment = Enum.TextXAlignment.Left
    list.TextYAlignment = Enum.TextYAlignment.Top
    list.Font = Enum.Font.FredokaOne
    list.TextSize = 34
    list.TextColor3 = Color3.fromRGB(236, 240, 250)
    list.Text = "Загрузка..."
    list.Parent = frame

    Kit.light(board, titleColor, 24, 1.6)
    return list
end

local function buildHub(ctx, root)
    local c = Builder.zoneCenter(1)
    local folder = Instance.new("Folder")
    folder.Name = "Hub"

    -- спавн
    local spawnPad = Instance.new("SpawnLocation")
    spawnPad.Name = "MainSpawn"
    spawnPad.Anchored = true
    spawnPad.Size = Vector3.new(22, 2, 22)
    spawnPad.Position = c + Vector3.new(0, FLOOR + 1.4, 34)
    spawnPad.Neutral = true
    spawnPad.Duration = 0
    spawnPad.Material = Enum.Material.Neon
    spawnPad.Color = Color3.fromRGB(95, 225, 130)
    spawnPad.TopSurface = Enum.SurfaceType.Smooth
    spawnPad.Parent = folder
    Kit.light(spawnPad, Color3.fromRGB(120, 235, 150), 24, 2)

    -- доски лидеров
    local topList = buildBoard(c + Vector3.new(-HALF + 26, 32, 66), "🏆 ТОП КОДЕРОВ", Color3.fromRGB(255, 214, 96), folder)
    local donList = buildBoard(c + Vector3.new(-HALF + 26, 32, -66), "💎 ТОП ДОНАТЕРОВ", Color3.fromRGB(90, 205, 255), folder)

    -- ряд стендов: донат / колесо / ежедневка / коды
    local donatePrompt = Kit.stand(c + Vector3.new(-100, FLOOR, 116), {
        name = "DonateStand", icon = "💎", title = "ДОНАТ-МАГАЗИН", action = "Открыть", color = Color3.fromRGB(70, 170, 255), width = 300,
    }, folder)
    donatePrompt.Triggered:Connect(function(plr) ctx.onDonate(plr) end)

    local dailyPrompt = Kit.stand(c + Vector3.new(-56, FLOOR, 116), {
        name = "DailyStand", icon = "🎁", title = "ЕЖЕДНЕВНЫЙ СУНДУК", action = "Забрать", color = Color3.fromRGB(255, 180, 70), width = 320,
    }, folder)
    dailyPrompt.Triggered:Connect(function(plr) ctx.onDaily(plr) end)

    local codesPrompt = Kit.stand(c + Vector3.new(56, FLOOR, 116), {
        name = "CodesStand", icon = "🎟", title = "ВВЕСТИ КОД", action = "Открыть", color = Color3.fromRGB(120, 220, 150), width = 280,
    }, folder)
    codesPrompt.Triggered:Connect(function(plr) ctx.onCodes(plr) end)

    -- колесо удачи: сегменты реально крутятся
    local wheelCenter = c + Vector3.new(104, FLOOR + 26, 116)
    Kit.pillar(c + Vector3.new(104, FLOOR + 13, 116), 5, 26, Color3.fromRGB(52, 56, 70), folder, Enum.Material.Metal)
    local hubDisc = Kit.disc(wheelCenter, 12, 3, Color3.fromRGB(38, 40, 52), folder, Enum.Material.Metal)
    hubDisc.CFrame = CFrame.new(wheelCenter)
    for k = 1, 8 do
        local prize = Config.WHEEL[k]
        local seg = Kit.deco({
            Name = "WheelSegment",
            Size = Vector3.new(20, 1.6, 8),
            Color = prize and prize.color or Color3.fromRGB(200, 200, 200),
            Material = Enum.Material.Neon,
        }, folder)
        Kit.markOrbit(seg, wheelCenter, 12, 0.9, 0)
        seg:SetAttribute("OrbitPhase", (k - 1) * (math.pi * 2 / 8))
    end
    local pointer = Kit.wedge({
        Name = "WheelPointer",
        Size = Vector3.new(3, 7, 7),
        CFrame = CFrame.new(wheelCenter + Vector3.new(0, 26, 0)) * CFrame.Angles(math.rad(180), 0, 0),
        Color = Color3.fromRGB(255, 90, 90),
        Material = Enum.Material.Neon,
    }, folder)
    Kit.light(pointer, Color3.fromRGB(255, 90, 90), 18, 2)
    local wheelBase = Kit.part({Name = "WheelBase", Size = Vector3.new(10, 8, 10), Position = c + Vector3.new(104, FLOOR + 4, 116), Color = Color3.fromRGB(30, 32, 42)}, folder)
    Kit.billboard(wheelBase, "🎰 КОЛЕСО УДАЧИ", Color3.fromRGB(255, 150, 200), 300, 6)
    local wheelPrompt = Instance.new("ProximityPrompt")
    wheelPrompt.ActionText = "Крутить"
    wheelPrompt.ObjectText = "Колесо удачи"
    wheelPrompt.KeyboardKeyCode = Enum.KeyCode.F
    wheelPrompt.MaxActivationDistance = 18
    wheelPrompt.RequiresLineOfSight = false
    wheelPrompt.Parent = wheelBase
    wheelPrompt.Triggered:Connect(function(plr) ctx.onWheel(plr) end)

    -- VIP-лифт: телепорт в лофт для владельцев геймпасса
    local vipPad = Kit.pad(c + Vector3.new(112, FLOOR + 1.2, -108), 18, Color3.fromRGB(255, 205, 70), "👑 VIP-ЛОФТ", folder, 260)
    vipPad.Name = "VipPad"
    Kit.arch(c + Vector3.new(112, FLOOR, -108), 34, 26, "ТОЛЬКО VIP", Color3.fromRGB(255, 205, 70), folder)
    local vipDeb = {}
    vipPad.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if not plr then return end
        if vipDeb[plr] and os.clock() - vipDeb[plr] < 1.5 then return end
        vipDeb[plr] = os.clock()
        ctx.onVip(plr)
    end)

    folder.Parent = root
    return {folder = folder, topList = topList, donList = donList, spawn = spawnPad}
end

--========================== VIP-ЛОФТ ===================================

local function buildVipLounge(ctx, root)
    local c = Builder.VIP_CENTER
    local folder = Instance.new("Folder")
    folder.Name = "VipLounge"
    local gold = Color3.fromRGB(255, 205, 70)

    Kit.floatingIsland(c, 150, {
        ground = Color3.fromRGB(60, 58, 74),
        ground2 = Color3.fromRGB(48, 46, 62),
        rock = Color3.fromRGB(40, 38, 52),
        accent = gold,
    }, folder, 0, {})

    Kit.deco({Name = "GoldFloor", Size = Vector3.new(120, 1, 120), Position = c + Vector3.new(0, FLOOR + 0.6, 0), Color = Color3.fromRGB(88, 78, 58), Material = Enum.Material.Marble}, folder)
    Kit.signBoard(c + Vector3.new(0, FLOOR, -56), "VIP-ЛОФТ", gold, 46, folder, "спасибо за поддержку 💛")

    Kit.tower(c + Vector3.new(-46, 0, -30), 2, Color3.fromRGB(250, 240, 214), gold, folder)
    for _, dx in ipairs({-30, 30}) do
        Kit.tree(c + Vector3.new(dx, 3, 44), folder, "palm", Color3.fromRGB(220, 200, 120))
    end

    -- пад двойных денег: пока стоишь — идёт буст
    local boostPad = Kit.pad(c + Vector3.new(0, FLOOR + 1.2, 10), 28, gold, "💛 x2 ДЕНЬГИ ПОКА ТУТ", folder, 320)
    boostPad.Name = "VipBoostPad"
    local last = {}
    boostPad.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if not plr then return end
        if last[plr] and os.clock() - last[plr] < 4 then return end
        last[plr] = os.clock()
        ctx.onVipBoost(plr)
    end)

    -- обратный пад
    local backPad = Kit.pad(c + Vector3.new(0, FLOOR + 1.2, 62), 16, Color3.fromRGB(120, 200, 255), "◀ ВЕРНУТЬСЯ", folder, 240)
    backPad.Name = "VipBack"
    local bd = {}
    backPad.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if not plr then return end
        if bd[plr] and os.clock() - bd[plr] < 1.5 then return end
        bd[plr] = os.clock()
        ctx.onTravel(plr, 1)
    end)

    for k = 1, 6 do
        local coin = Kit.coin(c + Vector3.new(math.random(-50, 50), FLOOR + 10, math.random(-40, 40)), folder, 5)
        Kit.markBob(coin, 1.6, 0.9)
    end
    Kit.holoRing(c + Vector3.new(0, FLOOR + 30, 10), 60, gold, folder, 1.4)

    folder.Parent = root
    return folder
end

--========================== ТОЧКА ВХОДА ================================

function Builder.build(ctx)
    local root = Instance.new("Folder")
    root.Name = "DevWorld"

    local zones = {}
    for i = 1, #Config.ZONES do
        zones[i] = buildZone(i, ctx, root)
    end
    for i = 1, #Config.ZONES - 1 do
        buildBridge(i, ctx, root)
    end

    local hub = buildHub(ctx, root)
    buildVipLounge(ctx, root)

    -- ловушка пустоты: упал — вернулся в свою зону
    local catcher = Kit.part({
        Name = "VoidCatcher",
        Size = Vector3.new(12000, 4, 12000),
        Position = Vector3.new(Config.ZONE_GAP * 2, -260, 0),
        Transparency = 1,
        CanCollide = false,
    }, root)
    catcher.Touched:Connect(function(hit)
        local plr = game:GetService("Players"):GetPlayerFromCharacter(hit.Parent)
        if plr then ctx.onFall(plr) end
    end)

    root.Parent = Workspace

    return {
        root = root,
        zones = zones,
        hub = hub,
        topList = hub.topList,
        donList = hub.donList,
    }
end

return Builder
