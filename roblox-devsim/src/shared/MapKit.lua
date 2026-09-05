--========================================================================
--  MapKit — детальки, из которых собирается карта.
--  Мультяшный стиль: гладкий пластик + неон + толстые формы.
--  Анимация (вращение, покачивание, пульс) помечается тегами и крутится
--  НА КЛИЕНТЕ — сервер не тратит сеть на движение декораций.
--  Лежит в ReplicatedStorage > DevSim > MapKit
--========================================================================

local CollectionService = game:GetService("CollectionService")
local RunService        = game:GetService("RunService")

local Kit = {}

Kit.TAG_SPIN  = "DevSpin"
Kit.TAG_BOB   = "DevBob"
Kit.TAG_PULSE = "DevPulse"
Kit.TAG_ORBIT = "DevOrbit"

local FONT = Enum.Font.FredokaOne
local BLACK = Color3.fromRGB(0, 0, 0)

--========================== БАЗОВЫЕ ФОРМЫ ==============================

function Kit.part(props, parent)
    local p = Instance.new("Part")
    p.Anchored = true
    p.CanCollide = true
    p.CastShadow = false
    p.TopSurface = Enum.SurfaceType.Smooth
    p.BottomSurface = Enum.SurfaceType.Smooth
    p.Material = Enum.Material.SmoothPlastic
    for k, v in pairs(props) do
        p[k] = v
    end
    p.Parent = parent
    return p
end

function Kit.deco(props, parent)
    props.CanCollide = (props.CanCollide == true)
    return Kit.part(props, parent)
end

function Kit.neon(props, parent)
    props.Material = Enum.Material.Neon
    return Kit.part(props, parent)
end

function Kit.glass(props, parent)
    props.Material = Enum.Material.Glass
    if props.Transparency == nil then props.Transparency = 0.55 end
    if props.Reflectance == nil then props.Reflectance = 0.12 end
    return Kit.part(props, parent)
end

function Kit.ball(props, parent)
    props.Shape = Enum.PartType.Ball
    return Kit.part(props, parent)
end

-- Столб/труба: цилиндр вдоль оси Y.
function Kit.pillar(pos, diameter, height, color, parent, material)
    local p = Kit.part({
        Name = "Pillar",
        Size = Vector3.new(height, diameter, diameter),
        Color = color,
        Material = material or Enum.Material.SmoothPlastic,
    }, parent)
    p.Shape = Enum.PartType.Cylinder
    p.CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90))
    return p
end

-- Диск (монета, площадка, кольцо).
function Kit.disc(pos, diameter, thickness, color, parent, material)
    local p = Kit.part({
        Name = "Disc",
        Size = Vector3.new(thickness, diameter, diameter),
        Color = color,
        Material = material or Enum.Material.SmoothPlastic,
        CanCollide = false,
    }, parent)
    p.Shape = Enum.PartType.Cylinder
    p.CFrame = CFrame.new(pos) * CFrame.Angles(0, 0, math.rad(90))
    return p
end

function Kit.wedge(props, parent)
    local p = Instance.new("WedgePart")
    p.Anchored = true
    p.CanCollide = false
    p.CastShadow = false
    p.Material = Enum.Material.SmoothPlastic
    for k, v in pairs(props) do
        p[k] = v
    end
    p.Parent = parent
    return p
end

--========================== СВЕТ И ЭФФЕКТЫ =============================

function Kit.light(parent, color, range, brightness)
    local l = Instance.new("PointLight")
    l.Color = color
    l.Range = range or 18
    l.Brightness = brightness or 2
    l.Shadows = false
    l.Parent = parent
    return l
end

function Kit.emit(part, color, rate, size, speed, lifetime)
    local pe = Instance.new("ParticleEmitter")
    pe.Color = ColorSequence.new(color)
    pe.Size = NumberSequence.new(size or 1.2)
    pe.Lifetime = NumberRange.new(0.7, lifetime or 1.6)
    pe.Rate = rate or 12
    pe.Speed = NumberRange.new(speed or 4)
    pe.SpreadAngle = Vector2.new(35, 35)
    pe.Transparency = NumberSequence.new({
        NumberSequenceKeypoint.new(0, 0.25),
        NumberSequenceKeypoint.new(1, 1),
    })
    pe.LightEmission = 0.9
    pe.Rotation = NumberRange.new(0, 360)
    pe.LockedToPart = true
    pe.Parent = part
    return pe
end

--========================== АНИМАЦИИ (ТЕГИ) ============================

function Kit.markSpin(part, speed, axis)
    part:SetAttribute("SpinSpeed", speed or 1)
    part:SetAttribute("SpinAxis", axis or "Y")
    CollectionService:AddTag(part, Kit.TAG_SPIN)
    return part
end

function Kit.markBob(part, amp, speed)
    part:SetAttribute("BobAmp", amp or 1.5)
    part:SetAttribute("BobSpeed", speed or 1.2)
    part:SetAttribute("BobPhase", math.random() * 6.28)
    CollectionService:AddTag(part, Kit.TAG_BOB)
    return part
end

function Kit.markPulse(part, speed)
    part:SetAttribute("PulseSpeed", speed or 1.4)
    CollectionService:AddTag(part, Kit.TAG_PULSE)
    return part
end

-- Полёт по кругу (дроны, спутники).
function Kit.markOrbit(part, center, radius, speed, height)
    part:SetAttribute("OrbitX", center.X)
    part:SetAttribute("OrbitY", center.Y)
    part:SetAttribute("OrbitZ", center.Z)
    part:SetAttribute("OrbitR", radius)
    part:SetAttribute("OrbitSpeed", speed or 0.5)
    part:SetAttribute("OrbitBob", height or 0)
    part:SetAttribute("OrbitPhase", math.random() * 6.28)
    CollectionService:AddTag(part, Kit.TAG_ORBIT)
    return part
end

-- Вызывается ТОЛЬКО на клиенте: одна петля крутит весь декор локально.
function Kit.runClientAnimations()
    if not RunService:IsClient() then return end
    if Kit._animationsRunning then return end
    Kit._animationsRunning = true

    local clock = 0
    local base = {}

    local function remember(part)
        if not base[part] then
            base[part] = part.CFrame
        end
        return base[part]
    end

    RunService.Heartbeat:Connect(function(dt)
        clock = clock + dt

        for _, part in ipairs(CollectionService:GetTagged(Kit.TAG_SPIN)) do
            if part:IsA("BasePart") then
                local start = remember(part)
                local speed = part:GetAttribute("SpinSpeed") or 1
                local axis = part:GetAttribute("SpinAxis") or "Y"
                local angle = clock * speed
                local rot
                if axis == "X" then
                    rot = CFrame.Angles(angle, 0, 0)
                elseif axis == "Z" then
                    rot = CFrame.Angles(0, 0, angle)
                else
                    rot = CFrame.Angles(0, angle, 0)
                end
                part.CFrame = start * rot
            end
        end

        for _, part in ipairs(CollectionService:GetTagged(Kit.TAG_BOB)) do
            if part:IsA("BasePart") then
                local start = remember(part)
                local amp = part:GetAttribute("BobAmp") or 1.5
                local speed = part:GetAttribute("BobSpeed") or 1.2
                local phase = part:GetAttribute("BobPhase") or 0
                local dy = math.sin(clock * speed + phase) * amp
                part.CFrame = start + Vector3.new(0, dy, 0)
            end
        end

        for _, part in ipairs(CollectionService:GetTagged(Kit.TAG_ORBIT)) do
            if part:IsA("BasePart") then
                local cx = part:GetAttribute("OrbitX") or 0
                local cy = part:GetAttribute("OrbitY") or 0
                local cz = part:GetAttribute("OrbitZ") or 0
                local r = part:GetAttribute("OrbitR") or 20
                local speed = part:GetAttribute("OrbitSpeed") or 0.5
                local bobH = part:GetAttribute("OrbitBob") or 0
                local phase = part:GetAttribute("OrbitPhase") or 0
                local a = clock * speed + phase
                local pos = Vector3.new(cx + math.cos(a) * r, cy + math.sin(a * 1.7) * bobH, cz + math.sin(a) * r)
                part.CFrame = CFrame.new(pos, pos + Vector3.new(-math.sin(a), 0, math.cos(a)))
            end
        end

        for _, part in ipairs(CollectionService:GetTagged(Kit.TAG_PULSE)) do
            if part:IsA("BasePart") then
                local speed = part:GetAttribute("PulseSpeed") or 1.4
                local k = 0.5 + 0.5 * math.sin(clock * speed)
                local light = part:FindFirstChildOfClass("PointLight")
                if light then
                    light.Brightness = 1 + k * 2.4
                end
                part.Transparency = 0.05 + k * 0.25
            end
        end
    end)
end

--========================== ТЕКСТ И ВЫВЕСКИ ============================

function Kit.surfaceText(part, text, color, face, pixelsX, pixelsY)
    local sg = Instance.new("SurfaceGui")
    sg.Face = face or Enum.NormalId.Front
    sg.Adornee = part
    sg.LightInfluence = 0
    sg.CanvasSize = Vector2.new(pixelsX or 480, pixelsY or 180)
    sg.MaxDistance = 700
    sg.Parent = part

    local tl = Instance.new("TextLabel")
    tl.Size = UDim2.fromScale(1, 1)
    tl.BackgroundTransparency = 1
    tl.Text = text
    tl.Font = FONT
    tl.TextScaled = true
    tl.TextColor3 = color or Color3.new(1, 1, 1)
    tl.Parent = sg

    local s = Instance.new("UIStroke")
    s.Color = BLACK
    s.Thickness = 2
    s.Parent = tl
    return tl
end

function Kit.billboard(part, text, color, width, offsetY)
    local bb = Instance.new("BillboardGui")
    bb.Size = UDim2.new(0, width or 240, 0, 62)
    bb.StudsOffset = Vector3.new(0, offsetY or 4, 0)
    bb.AlwaysOnTop = false
    bb.LightInfluence = 0
    bb.MaxDistance = 260
    bb.Adornee = part
    bb.Parent = part

    local bg = Instance.new("Frame")
    bg.Size = UDim2.fromScale(1, 1)
    bg.BackgroundColor3 = Color3.fromRGB(26, 28, 34)
    bg.BackgroundTransparency = 0.12
    bg.Parent = bb
    local c = Instance.new("UICorner")
    c.CornerRadius = UDim.new(0, 14)
    c.Parent = bg
    local st = Instance.new("UIStroke")
    st.Color = color or Color3.fromRGB(0, 229, 255)
    st.Thickness = 2.5
    st.Parent = bg

    local tl = Instance.new("TextLabel")
    tl.Size = UDim2.new(1, -10, 1, -8)
    tl.Position = UDim2.new(0, 5, 0, 4)
    tl.BackgroundTransparency = 1
    tl.Text = text
    tl.Font = FONT
    tl.TextScaled = true
    tl.TextColor3 = Color3.new(1, 1, 1)
    tl.Parent = bg
    local s = Instance.new("UIStroke")
    s.Color = BLACK
    s.Thickness = 1.6
    s.Parent = tl
    return tl
end

-- Вывеска на двух ножках (как в мультяшных симуляторах).
function Kit.signBoard(pos, text, color, width, parent, subText)
    local w = width or 34
    Kit.pillar(pos + Vector3.new(-w / 2 + 2, 6, 0), 2.2, 12, Color3.fromRGB(52, 56, 68), parent, Enum.Material.Metal)
    Kit.pillar(pos + Vector3.new(w / 2 - 2, 6, 0), 2.2, 12, Color3.fromRGB(52, 56, 68), parent, Enum.Material.Metal)

    local back = Kit.deco({
        Name = "SignBack",
        Size = Vector3.new(w + 2, 12, 1.4),
        Position = pos + Vector3.new(0, 16, 0),
        Color = color,
        Material = Enum.Material.Neon,
    }, parent)
    local face = Kit.deco({
        Name = "SignFace",
        Size = Vector3.new(w - 1, 10, 2),
        Position = pos + Vector3.new(0, 16, 0),
        Color = Color3.fromRGB(24, 26, 32),
    }, parent)
    Kit.surfaceText(face, subText and (text .. "\n" .. subText) or text, Color3.new(1, 1, 1), Enum.NormalId.Front, 520, 150)
    Kit.surfaceText(face, subText and (text .. "\n" .. subText) or text, Color3.new(1, 1, 1), Enum.NormalId.Back, 520, 150)
    Kit.light(back, color, 22, 1.6)
    Kit.markPulse(back, 1.1)
    return face
end

-- Триумфальная арка над входом. rotY (градусы) разворачивает арку:
-- 0 = проход вдоль оси Z, 90 = проход вдоль оси X (например, над мостом).
function Kit.arch(pos, width, height, text, color, parent, rotY)
    local w = width or 44
    local h = height or 26
    local base = CFrame.new(pos) * CFrame.Angles(0, math.rad(rotY or 0), 0)

    local legL = Kit.part({Name = "ArchLeg", Size = Vector3.new(4, h, 4), Color = color}, parent)
    legL.CFrame = base * CFrame.new(-w / 2, h / 2, 0)
    local legR = Kit.part({Name = "ArchLeg", Size = Vector3.new(4, h, 4), Color = color}, parent)
    legR.CFrame = base * CFrame.new(w / 2, h / 2, 0)

    local beam = Kit.part({Name = "ArchBeam", Size = Vector3.new(w + 6, 8, 4), Color = color}, parent)
    beam.CFrame = base * CFrame.new(0, h + 3, 0)
    Kit.surfaceText(beam, text, Color3.new(1, 1, 1), Enum.NormalId.Front, 620, 120)
    Kit.surfaceText(beam, text, Color3.new(1, 1, 1), Enum.NormalId.Back, 620, 120)

    local glow = Kit.neon({Name = "ArchGlow", Size = Vector3.new(w + 8, 1.4, 5), Color = color, CanCollide = false}, parent)
    glow.CFrame = base * CFrame.new(0, h + 7.4, 0)
    Kit.light(glow, color, 26, 2)
    Kit.markPulse(glow, 0.9)
    return beam
end

--========================== ЛАНДШАФТ ===================================

-- Летающий остров: травяная шапка + скалистое основание конусом.
function Kit.floatingIsland(center, size, palette, parent, y, openings)
    local top = y or 0
    local half = size / 2

    Kit.part({
        Name = "Ground",
        Size = Vector3.new(size, 6, size),
        Position = center + Vector3.new(0, top, 0),
        Color = palette.ground,
        Material = Enum.Material.Grass,
    }, parent)

    -- каёмка чуть темнее — читается как "мультяшный кант"
    Kit.deco({
        Name = "GroundEdge",
        Size = Vector3.new(size + 4, 3.2, size + 4),
        Position = center + Vector3.new(0, top - 2.4, 0),
        Color = palette.ground2,
        Material = Enum.Material.Grass,
        CanCollide = true,
    }, parent)

    -- скальное основание: несколько уменьшающихся плит
    local layers = 5
    for i = 1, layers do
        local k = i / layers
        local w = size * (1 - k * 0.72)
        Kit.deco({
            Name = "Rock",
            Size = Vector3.new(w, 12, w),
            Position = center + Vector3.new(0, top - 6 - i * 9, 0),
            Color = palette.rock,
            Material = Enum.Material.Slate,
        }, parent)
    end
    Kit.deco({
        Name = "RockTip",
        Size = Vector3.new(size * 0.16, 26, size * 0.16),
        Position = center + Vector3.new(0, top - 62, 0),
        Color = palette.rock,
        Material = Enum.Material.Slate,
    }, parent)

    -- невидимые стенки по краю, чтобы не падать.
    -- openings = {west = true, east = true} оставляет проём под мост.
    openings = openings or {}
    for _, s in ipairs({1, -1}) do
        Kit.part({Name = "Barrier", Size = Vector3.new(size, 60, 2), Position = center + Vector3.new(0, top + 30, s * half), Transparency = 1}, parent)
    end
    local gap = 26
    local sideOpen = {[1] = openings.east, [-1] = openings.west}
    for _, s in ipairs({1, -1}) do
        if sideOpen[s] then
            local segment = (size - gap) / 2
            for _, zs in ipairs({1, -1}) do
                Kit.part({
                    Name = "Barrier",
                    Size = Vector3.new(2, 60, segment),
                    Position = center + Vector3.new(s * half, top + 30, zs * (gap / 2 + segment / 2)),
                    Transparency = 1,
                }, parent)
            end
        else
            Kit.part({Name = "Barrier", Size = Vector3.new(2, 60, size), Position = center + Vector3.new(s * half, top + 30, 0), Transparency = 1}, parent)
        end
    end

    -- светящийся кант по периметру
    for _, s in ipairs({1, -1}) do
        Kit.deco({Name = "Rim", Size = Vector3.new(size + 5, 1.6, 3), Position = center + Vector3.new(0, top + 3.2, s * half), Color = palette.accent, Material = Enum.Material.Neon}, parent)
        Kit.deco({Name = "Rim", Size = Vector3.new(3, 1.6, size + 5), Position = center + Vector3.new(s * half, top + 3.2, 0), Color = palette.accent, Material = Enum.Material.Neon}, parent)
    end
end

function Kit.path(pos, width, length, parent, color)
    Kit.deco({
        Name = "Path",
        Size = Vector3.new(width, 0.6, length),
        Position = pos + Vector3.new(0, 3.2, 0),
        Color = color or Color3.fromRGB(226, 218, 198),
        Material = Enum.Material.Concrete,
    }, parent)
end

function Kit.tree(pos, parent, style, tint)
    style = style or "oak"
    if style == "pine" then
        Kit.part({Name = "Trunk", Size = Vector3.new(2.4, 9, 2.4), Position = pos + Vector3.new(0, 4.5, 0), Color = Color3.fromRGB(104, 72, 48)}, parent)
        for i = 0, 2 do
            local s = 13 - i * 3.4
            Kit.deco({Name = "Pine", Size = Vector3.new(s, 6, s), Position = pos + Vector3.new(0, 9 + i * 5, 0), Color = tint or Color3.fromRGB(64, 150, 92), Material = Enum.Material.Grass}, parent)
        end
    elseif style == "palm" then
        for i = 0, 5 do
            Kit.deco({Name = "Trunk", Size = Vector3.new(2.4, 3.4, 2.4), Position = pos + Vector3.new(i * 0.5, 2 + i * 3.2, 0), Color = Color3.fromRGB(158, 122, 82)}, parent)
        end
        for a = 0, 5 do
            local ang = math.rad(a * 60)
            local leaf = Kit.deco({
                Name = "Leaf",
                Size = Vector3.new(13, 1, 5),
                Color = tint or Color3.fromRGB(88, 194, 108),
                Material = Enum.Material.Grass,
            }, parent)
            leaf.CFrame = CFrame.new(pos + Vector3.new(2.5, 21, 0)) * CFrame.Angles(0, ang, math.rad(-14)) * CFrame.new(6.5, 0, 0)
        end
        Kit.ball({Name = "Coconut", Size = Vector3.new(2.4, 2.4, 2.4), Position = pos + Vector3.new(2.5, 19.4, 1.4), Color = Color3.fromRGB(96, 68, 44), CanCollide = false}, parent)
    else
        Kit.part({Name = "Trunk", Size = Vector3.new(3, 10, 3), Position = pos + Vector3.new(0, 5, 0), Color = Color3.fromRGB(122, 84, 52)}, parent)
        Kit.ball({Name = "Leaf", Size = Vector3.new(15, 15, 15), Position = pos + Vector3.new(0, 15, 0), Color = tint or Color3.fromRGB(92, 190, 96), Material = Enum.Material.Grass, CanCollide = false}, parent)
        Kit.ball({Name = "Leaf", Size = Vector3.new(9.5, 9.5, 9.5), Position = pos + Vector3.new(4.5, 18.5, 1.5), Color = tint or Color3.fromRGB(112, 208, 112), Material = Enum.Material.Grass, CanCollide = false}, parent)
        Kit.ball({Name = "Leaf", Size = Vector3.new(8.5, 8.5, 8.5), Position = pos + Vector3.new(-4.5, 17.5, -1.5), Color = tint or Color3.fromRGB(80, 176, 92), Material = Enum.Material.Grass, CanCollide = false}, parent)
    end
end

function Kit.bush(pos, color, parent)
    Kit.ball({Name = "Bush", Size = Vector3.new(9, 6.5, 9), Position = pos + Vector3.new(0, 2.6, 0), Color = color, Material = Enum.Material.Grass, CanCollide = false}, parent)
    Kit.ball({Name = "Bush", Size = Vector3.new(6, 5, 6), Position = pos + Vector3.new(4, 2, 1.5), Color = color, Material = Enum.Material.Grass, CanCollide = false}, parent)
end

function Kit.flowers(pos, color, parent)
    for k = 0, 2 do
        local off = Vector3.new((k - 1) * 3.4, 0, (k % 2) * 3.2)
        Kit.deco({Name = "Stem", Size = Vector3.new(0.5, 3, 0.5), Position = pos + off + Vector3.new(0, 1.5, 0), Color = Color3.fromRGB(88, 172, 88)}, parent)
        Kit.ball({Name = "Petals", Size = Vector3.new(2.4, 2.4, 2.4), Position = pos + off + Vector3.new(0, 3.4, 0), Color = color, CanCollide = false}, parent)
    end
end

function Kit.rock(pos, parent, color)
    Kit.ball({Name = "Rock", Size = Vector3.new(7, 5.4, 6.4), Position = pos + Vector3.new(0, 2, 0), Color = color or Color3.fromRGB(126, 129, 138), Material = Enum.Material.Slate}, parent)
    Kit.ball({Name = "Rock", Size = Vector3.new(4, 3.4, 4), Position = pos + Vector3.new(4, 1.4, 1.6), Color = color or Color3.fromRGB(140, 142, 150), Material = Enum.Material.Slate}, parent)
end

function Kit.cloud(pos, parent)
    local c = Kit.ball({Name = "Cloud", Size = Vector3.new(24, 14, 18), Position = pos, Color = Color3.fromRGB(255, 255, 255), CanCollide = false}, parent)
    Kit.ball({Name = "Cloud", Size = Vector3.new(16, 12, 14), Position = pos + Vector3.new(12, -1, 2), Color = Color3.fromRGB(246, 250, 255), CanCollide = false}, parent)
    Kit.ball({Name = "Cloud", Size = Vector3.new(13, 10, 12), Position = pos + Vector3.new(-11, -1.5, -2), Color = Color3.fromRGB(240, 246, 255), CanCollide = false}, parent)
    Kit.markBob(c, 2.2, 0.6)
    return c
end

function Kit.lamp(pos, color, parent, height)
    local h = height or 17
    Kit.pillar(pos + Vector3.new(0, h / 2, 0), 1.7, h, Color3.fromRGB(56, 60, 72), parent, Enum.Material.Metal)
    local bulb = Kit.ball({Name = "Bulb", Size = Vector3.new(4.6, 4.6, 4.6), Position = pos + Vector3.new(0, h + 1.2, 0), Color = color, Material = Enum.Material.Neon, CanCollide = false}, parent)
    Kit.light(bulb, color, 26, 2.2)
    Kit.markPulse(bulb, 0.8)
    return bulb
end

function Kit.fence(center, half, color, parent, step)
    local d = half - 5
    local s = step or 26
    for x = -d, d, s do
        Kit.deco({Name = "Picket", Size = Vector3.new(1.6, 8, 1.6), Position = center + Vector3.new(x, 6.5, d), Color = color, Material = Enum.Material.WoodPlanks}, parent)
        Kit.deco({Name = "Picket", Size = Vector3.new(1.6, 8, 1.6), Position = center + Vector3.new(x, 6.5, -d), Color = color, Material = Enum.Material.WoodPlanks}, parent)
    end
    for z = -d, d, s do
        Kit.deco({Name = "Picket", Size = Vector3.new(1.6, 8, 1.6), Position = center + Vector3.new(d, 6.5, z), Color = color, Material = Enum.Material.WoodPlanks}, parent)
        Kit.deco({Name = "Picket", Size = Vector3.new(1.6, 8, 1.6), Position = center + Vector3.new(-d, 6.5, z), Color = color, Material = Enum.Material.WoodPlanks}, parent)
    end
end

--========================== ПОСТРОЙКИ ==================================

-- Дом/офис: коробка + окна + дверь + крыша + вывеска.
function Kit.building(opts, parent)
    local pos      = opts.pos
    local w        = opts.width or 40
    local h        = opts.height or 26
    local d        = opts.depth or 26
    local wall     = opts.wall or Color3.fromRGB(240, 236, 226)
    local roof     = opts.roof or Color3.fromRGB(70, 76, 96)
    local accent   = opts.accent or Color3.fromRGB(0, 229, 255)
    local glassCol = opts.glass or Color3.fromRGB(150, 220, 255)

    Kit.part({Name = "Wall", Size = Vector3.new(w, h, d), Position = pos + Vector3.new(0, h / 2 + 3, 0), Color = wall, Material = opts.material or Enum.Material.SmoothPlastic}, parent)

    if opts.roofStyle == "gable" then
        local wg = Kit.wedge({Name = "Roof", Size = Vector3.new(d / 2 + 1, 9, w + 4), Color = roof, Material = Enum.Material.Slate}, parent)
        wg.CFrame = CFrame.new(pos + Vector3.new(0, h + 7.5, -d / 4)) * CFrame.Angles(0, math.rad(90), 0)
        local wg2 = Kit.wedge({Name = "Roof", Size = Vector3.new(d / 2 + 1, 9, w + 4), Color = roof, Material = Enum.Material.Slate}, parent)
        wg2.CFrame = CFrame.new(pos + Vector3.new(0, h + 7.5, d / 4)) * CFrame.Angles(0, math.rad(-90), 0)
    else
        Kit.part({Name = "Roof", Size = Vector3.new(w + 5, 3, d + 5), Position = pos + Vector3.new(0, h + 4.5, 0), Color = roof}, parent)
        Kit.deco({Name = "RoofTrim", Size = Vector3.new(w + 6, 1, d + 6), Position = pos + Vector3.new(0, h + 6.4, 0), Color = accent, Material = Enum.Material.Neon}, parent)
    end

    local front = -(d / 2 + 0.4)
    Kit.deco({Name = "Door", Size = Vector3.new(8, 12, 1), Position = pos + Vector3.new(0, 9, front), Color = opts.door or Color3.fromRGB(72, 52, 38), Material = Enum.Material.WoodPlanks}, parent)

    local rows = opts.windowRows or 1
    local cols = opts.windowCols or 2
    for r = 1, rows do
        for c = 1, cols do
            local x = (c - (cols + 1) / 2) * (w / (cols + 0.6))
            local y = 9 + r * (h / (rows + 0.7))
            if y < h - 1 then
                Kit.deco({Name = "Window", Size = Vector3.new(w / (cols + 1.6), h / (rows + 2.4), 0.8), Position = pos + Vector3.new(x, y, front), Color = glassCol, Material = Enum.Material.Neon}, parent)
            end
        end
    end

    if opts.title then
        local sign = Kit.deco({Name = "Sign", Size = Vector3.new(w - 10, 6, 1), Position = pos + Vector3.new(0, h - 1, front - 0.4), Color = Color3.fromRGB(26, 28, 34)}, parent)
        Kit.surfaceText(sign, opts.title, Color3.new(1, 1, 1), Enum.NormalId.Front, 520, 90)
        Kit.light(sign, accent, 20, 1.6)
    end
end

-- Небоскрёб: несколько уменьшающихся блоков + шпиль.
function Kit.tower(pos, floors, wall, accent, parent, title)
    local w = 30
    local y = 3
    for i = 1, floors do
        local fw = w - (i - 1) * 2.2
        Kit.part({Name = "TowerFloor", Size = Vector3.new(fw, 14, fw), Position = pos + Vector3.new(0, y + 7, 0), Color = wall, Material = Enum.Material.SmoothPlastic}, parent)
        for _, s in ipairs({1, -1}) do
            Kit.deco({Name = "Band", Size = Vector3.new(fw + 0.6, 4, 0.8), Position = pos + Vector3.new(0, y + 8, s * (fw / 2 + 0.2)), Color = accent, Material = Enum.Material.Neon}, parent)
            Kit.deco({Name = "Band", Size = Vector3.new(0.8, 4, fw + 0.6), Position = pos + Vector3.new(s * (fw / 2 + 0.2), y + 8, 0), Color = accent, Material = Enum.Material.Neon}, parent)
        end
        y = y + 14
    end
    local spire = Kit.pillar(pos + Vector3.new(0, y + 9, 0), 3, 18, accent, parent, Enum.Material.Neon)
    Kit.light(spire, accent, 30, 2.4)
    Kit.markPulse(spire, 0.7)
    if title then
        local sign = Kit.deco({Name = "TowerSign", Size = Vector3.new(20, 7, 1), Position = pos + Vector3.new(0, y - 8, -(w / 2 - 3)), Color = Color3.fromRGB(24, 26, 32)}, parent)
        Kit.surfaceText(sign, title, accent, Enum.NormalId.Front, 420, 120)
    end
end

-- Рабочее место: стол + монитор со светящимся кодом. Возвращает экран.
function Kit.workstation(pos, opts, parent)
    local deskColor = opts.desk or Color3.fromRGB(150, 100, 60)
    local accent = opts.accent or Color3.fromRGB(120, 235, 170)

    Kit.part({Name = "Desk", Size = Vector3.new(18, 1.4, 8), Position = pos + Vector3.new(0, 6, 0), Color = deskColor, Material = opts.deskMaterial or Enum.Material.WoodPlanks}, parent)
    for _, dx in ipairs({-7.5, 7.5}) do
        Kit.deco({Name = "DeskLeg", Size = Vector3.new(1.2, 6, 7), Position = pos + Vector3.new(dx, 3, 0), Color = deskColor}, parent)
    end

    Kit.deco({Name = "Tower", Size = Vector3.new(4, 8, 6), Position = pos + Vector3.new(-6.5, 10.8, 0), Color = Color3.fromRGB(46, 50, 62), Material = Enum.Material.Metal}, parent)
    Kit.deco({Name = "Keyboard", Size = Vector3.new(9, 0.6, 3.2), Position = pos + Vector3.new(1.5, 7, 2.4), Color = Color3.fromRGB(56, 60, 72)}, parent)

    Kit.deco({Name = "Stand", Size = Vector3.new(2, 3, 2), Position = pos + Vector3.new(1.5, 8.2, -1), Color = Color3.fromRGB(46, 50, 62)}, parent)
    local screen = Kit.part({
        Name = "PC",
        Size = Vector3.new(11, 7, 0.7),
        Position = pos + Vector3.new(1.5, 13.4, -1),
        Color = Color3.fromRGB(30, 34, 46),
        CanCollide = false,
    }, parent)
    Kit.surfaceText(screen, opts.screenText or "</>", accent, Enum.NormalId.Front, 300, 200)
    Kit.light(screen, accent, 16, 1.6)
    Kit.emit(screen, accent, 8, 0.7, 2, 1.4)

    Kit.deco({Name = "Chair", Size = Vector3.new(5, 1, 5), Position = pos + Vector3.new(1.5, 5, 8), Color = Color3.fromRGB(60, 66, 82)}, parent)
    Kit.deco({Name = "ChairBack", Size = Vector3.new(5, 7, 1), Position = pos + Vector3.new(1.5, 8.5, 10.2), Color = Color3.fromRGB(60, 66, 82)}, parent)
    Kit.pillar(pos + Vector3.new(1.5, 3, 8), 1.4, 4, Color3.fromRGB(40, 44, 56), parent, Enum.Material.Metal)

    return screen
end

function Kit.serverRack(pos, accent, parent)
    Kit.part({Name = "Rack", Size = Vector3.new(7, 14, 6), Position = pos + Vector3.new(0, 10, 0), Color = Color3.fromRGB(38, 40, 50), Material = Enum.Material.Metal}, parent)
    for k = 0, 4 do
        local led = Kit.deco({Name = "LED", Size = Vector3.new(7.2, 0.6, 0.5), Position = pos + Vector3.new(0, 5 + k * 2.6, 3), Color = accent, Material = Enum.Material.Neon}, parent)
        if k % 2 == 0 then Kit.markPulse(led, 1.6 + k * 0.3) end
    end
end

function Kit.crate(pos, parent, color)
    Kit.part({Name = "Crate", Size = Vector3.new(5.5, 5.5, 5.5), Position = pos + Vector3.new(0, 5.8, 0), Color = color or Color3.fromRGB(172, 122, 66), Material = Enum.Material.WoodPlanks}, parent)
end

function Kit.bench(pos, parent)
    Kit.deco({Name = "Seat", Size = Vector3.new(11, 0.9, 4), Position = pos + Vector3.new(0, 7, 0), Color = Color3.fromRGB(152, 102, 62), Material = Enum.Material.WoodPlanks, CanCollide = true}, parent)
    Kit.deco({Name = "Back", Size = Vector3.new(11, 4.5, 0.9), Position = pos + Vector3.new(0, 9.4, -1.6), Color = Color3.fromRGB(152, 102, 62), Material = Enum.Material.WoodPlanks}, parent)
    Kit.deco({Name = "Leg", Size = Vector3.new(0.9, 4, 4), Position = pos + Vector3.new(-4.5, 5, 0), Color = Color3.fromRGB(108, 70, 42)}, parent)
    Kit.deco({Name = "Leg", Size = Vector3.new(0.9, 4, 4), Position = pos + Vector3.new(4.5, 5, 0), Color = Color3.fromRGB(108, 70, 42)}, parent)
end

function Kit.coin(pos, parent, size)
    local c = Kit.disc(pos, size or 4.2, 0.7, Color3.fromRGB(255, 214, 76), parent, Enum.Material.Neon)
    c.Name = "Coin"
    Kit.light(c, Color3.fromRGB(255, 214, 76), 12, 1.4)
    Kit.markSpin(c, 2.2, "X")
    return c
end

--========================== ИНТЕРАКТИВ =================================

-- Светящаяся площадка с подписью. Возвращает саму площадку.
function Kit.pad(pos, size, color, label, parent, labelWidth)
    local pad = Kit.part({
        Name = "Pad",
        Size = Vector3.new(size, 1.6, size),
        Position = pos,
        Color = color,
        Material = Enum.Material.Neon,
        CanCollide = false,
    }, parent)
    local ring = Kit.disc(pos + Vector3.new(0, 0.4, 0), size + 5, 0.5, color, parent, Enum.Material.Neon)
    ring.Name = "PadRing"
    Kit.markSpin(ring, 0.8, "X")
    if label then
        Kit.billboard(pad, label, color, labelWidth or 250, 6)
    end
    Kit.light(pad, color, 22, 2.2)
    Kit.markPulse(pad, 1.2)
    Kit.emit(pad, color, 14, 1.2, 4, 1.5)
    return pad
end

-- Стенд с кнопкой E (ProximityPrompt). Возвращает prompt.
function Kit.stand(pos, opts, parent)
    local color = opts.color or Color3.fromRGB(0, 200, 255)
    Kit.pillar(pos + Vector3.new(0, 5, 0), 4, 10, Color3.fromRGB(48, 52, 64), parent, Enum.Material.Metal)
    local body = Kit.part({
        Name = opts.name or "Stand",
        Size = Vector3.new(9, 9, 5),
        Position = pos + Vector3.new(0, 13, 0),
        Color = Color3.fromRGB(28, 30, 38),
    }, parent)
    Kit.deco({Name = "StandGlow", Size = Vector3.new(9.6, 9.6, 4.4), Position = pos + Vector3.new(0, 13, 0), Color = color, Material = Enum.Material.Neon, Transparency = 0.35}, parent)
    Kit.surfaceText(body, opts.icon or "🛒", Color3.new(1, 1, 1), Enum.NormalId.Front, 200, 200)
    Kit.surfaceText(body, opts.icon or "🛒", Color3.new(1, 1, 1), Enum.NormalId.Back, 200, 200)
    Kit.billboard(body, opts.title or "МАГАЗИН", color, opts.width or 250, 6)
    Kit.light(body, color, 20, 1.8)

    local prompt = Instance.new("ProximityPrompt")
    prompt.ActionText = opts.action or "Открыть"
    prompt.ObjectText = opts.title or "Магазин"
    prompt.KeyboardKeyCode = Enum.KeyCode.F
    prompt.MaxActivationDistance = opts.distance or 16
    prompt.RequiresLineOfSight = false
    prompt.HoldDuration = 0
    prompt.Parent = body
    return prompt, body
end

-- Мост между островами + перила. Возвращает середину моста.
function Kit.bridge(fromPos, toPos, color, parent, width)
    local w = width or 16
    local dir = (toPos - fromPos)
    local len = dir.Magnitude
    local mid = fromPos + dir * 0.5
    local look = CFrame.new(mid, toPos)

    local deck = Kit.part({Name = "BridgeDeck", Size = Vector3.new(w, 1.6, len), Color = Color3.fromRGB(228, 224, 210), Material = Enum.Material.Concrete}, parent)
    deck.CFrame = look

    for _, s in ipairs({1, -1}) do
        local rail = Kit.deco({Name = "BridgeRail", Size = Vector3.new(1.2, 4.5, len), Color = color, Material = Enum.Material.Neon}, parent)
        rail.CFrame = look * CFrame.new(s * (w / 2 - 0.6), 2.8, 0)
        local wall = Kit.part({Name = "BridgeWall", Size = Vector3.new(1, 14, len), Transparency = 1}, parent)
        wall.CFrame = look * CFrame.new(s * (w / 2 + 0.4), 7, 0)
    end

    -- фонари по бокам моста (сдвиг вдоль его поперечной оси, а не вдоль X мира)
    local right = look.RightVector
    local steps = math.max(2, math.floor(len / 45))
    for i = 0, steps do
        local t = i / steps
        local point = fromPos:Lerp(toPos, t)
        Kit.lamp(point + right * (w / 2 + 3) + Vector3.new(0, -1, 0), color, parent, 12)
        Kit.lamp(point - right * (w / 2 + 3) + Vector3.new(0, -1, 0), color, parent, 12)
    end
    return mid
end

-- Ворота закрытой зоны: силовое поле + табличка с требованием.
function Kit.gate(pos, color, text, parent, width, rotY)
    local w = width or 20
    local base = CFrame.new(pos) * CFrame.Angles(0, math.rad(rotY or 0), 0)

    local field = Kit.part({
        Name = "GateField",
        Size = Vector3.new(w, 22, 1.6),
        Color = color,
        Material = Enum.Material.ForceField,
        Transparency = 0.35,
        CanCollide = true,
    }, parent)
    field.CFrame = base * CFrame.new(0, 11, 0)

    local postL = Kit.part({Name = "GatePost", Size = Vector3.new(3, 22, 3), Color = Color3.fromRGB(48, 52, 64), Material = Enum.Material.Metal}, parent)
    postL.CFrame = base * CFrame.new(-w / 2, 11, 0)
    local postR = Kit.part({Name = "GatePost", Size = Vector3.new(3, 22, 3), Color = Color3.fromRGB(48, 52, 64), Material = Enum.Material.Metal}, parent)
    postR.CFrame = base * CFrame.new(w / 2, 11, 0)

    local plate = Kit.deco({Name = "GateSign", Size = Vector3.new(w - 2, 8, 1), Color = Color3.fromRGB(24, 26, 32)}, parent)
    plate.CFrame = base * CFrame.new(0, 25, 0)
    Kit.surfaceText(plate, text, color, Enum.NormalId.Front, 520, 160)
    Kit.surfaceText(plate, text, color, Enum.NormalId.Back, 520, 160)

    Kit.light(field, color, 24, 2)
    Kit.emit(field, color, 10, 1.6, 2, 2)
    return field, plate
end

-- Голограмма-кольцо (для космоса и порталов).
function Kit.holoRing(pos, diameter, color, parent, thickness)
    local ring = Kit.disc(pos, diameter, thickness or 1.2, color, parent, Enum.Material.Neon)
    ring.Name = "HoloRing"
    ring.Transparency = 0.25
    Kit.markSpin(ring, 0.9, "X")
    Kit.light(ring, color, 26, 2)
    return ring
end

return Kit
