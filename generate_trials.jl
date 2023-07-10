using Graphs

model_dir = "/Users/fred/projects/graphnav/model"
include("$model_dir/problem.jl")
include("$model_dir/utils.jl")

function default_graph_requirement(sgraph)
    is_connected(sgraph) || return false
    # all(vertices(sgraph)) do v
    #     length(neighbors(sgraph, v)) ≥ 1
    # end
end

function sample_graph(n; d=3, requirement=default_graph_requirement)
    for i in 1:10000
        sgraph = expected_degree_graph(fill(d, n)) |> random_orientation_dag
        # sgraph = expected_degree_graph(fill(2, n))
        requirement(sgraph) && return neighbor_list(sgraph)
    end
    error("Can't sample a graph!")
end

neighbor_list(sgraph) = neighbors.(Ref(sgraph), vertices(sgraph))

function default_problem_requirement(problem)
    n_steps = problem.n_steps
    if n_steps == -1
        n_steps = length(states(problem))
    end
    length(paths(problem; n_steps)) ≥ 2
end

function sample_problem_(;n, n_steps=-1, graph=sample_graph(n),
                        rdist=nothing, rewards=rand(rdist), start=rand(1:n))
    rewards = copy(rewards)
    rewards[start] = 0
    Problem(graph, rewards, start, n_steps)
end

function sample_problem(requirement=default_problem_requirement; kws...)
    for i in 1:10000
        problem = sample_problem_(;kws...)
        requirement(problem) && return problem
    end
    error("Can't sample a problem!")
end

discrete_uniform(v) = DiscreteNonParametric(v, ones(length(v)) / length(v))

function intro_graph(n)
    g = DiGraph(n)
    for i in 1:n
        add_edge!(g, i, mod1(i+3, n))
        add_edge!(g, i, mod1(i-2, n))
        # add_edge!(g, i, mod1(i+6, n))
    end
    g
end

function linear_rewards(n)
    @assert iseven(n)
    n2 = div(n,2)
    [-n2:1:-1; 1:1:n2]
end

function exponential_rewards(n; base=2)
    @assert iseven(n)
    n2 = div(n,2)
    v = base .^ (0:1:n2-1)
    sort!([-v; v])
end

function sample_nonmatching_perm(x)
    while true
        y = shuffle(x)
        if all(y .≠ x)
            return y
        end
    end
end

function sample_pairs(x)
    x = shuffle(x)
    y = sample_nonmatching_perm(x)
    collect(zip(x, y))
end

struct Shuffler{T}
    x::Vector{T}
end

function Random.rand(rng::AbstractRNG, s::Random.SamplerTrivial{<:Shuffler})
    shuffle(s[].x)
end


struct ForceHoverTrial
    p::Problem
    expansions::Vector{Tuple{Int, Int}}
end

function JSON.lower(t::ForceHoverTrial)
    (;JSON.lower(t.p)..., expansions=map(e -> e .- 1, t.expansions))
end

abstract type HoverGenerator end

function ForceHoverTrial(gen::HoverGenerator; kws...)
    problem = sample_problem(;kws...)
    expansions = generate(gen, problem)
    ForceHoverTrial(problem, expansions)
end


struct RolloutGenerator <: HoverGenerator
    n::Int
end

function generate(g::RolloutGenerator, problem::Problem)
    mapreduce(vcat, 1:g.n) do i
        sliding_window(rollout(problem), 2)
    end
end

sliding_window(xs, n) = [(xs[i], xs[i+1]) for i in 1:length(xs)-1]

function rollout(p::Problem)
    res = [p.start]
    for i in 1:p.n_steps
        push!(res, rand(children(p, res[end])))
    end
    res
end

struct RandomGenerator <: HoverGenerator
    n::Int
end

function generate(g::RandomGenerator, problem::Problem)
    repeatedly(g.n) do
        a = rand(states(problem))
        b = rand(children(problem, a))
        (a, b)
    end
end

function make_trials(; n=8, )
    graph = neighbor_list(intro_graph(n))
    rewards = exponential_rewards(n)
    rdist = Shuffler(rewards)

    # rewards = shuffle(repeat([-10, -5, 5, 10], cld(n, 4)))[1:n]
    kws = (;n, graph, rdist)

    trial_sets = map(1:10) do _
        mapreduce(vcat, 1:3) do _
            sample_pairs(rewards)
        end
    end
    learn_rewards = (;trial_sets)

    intro = sample_problem(;kws..., rewards=zeros(n))
    prms = grid(
        # n_steps = [5],
        # n_roll = [1, 5],
        n_steps = 3:5,
        n_roll = 1:5
    )
    main = map(repeat(prms[:], 2)) do (;n_steps, n_roll)
        ForceHoverTrial(RolloutGenerator(n_roll); kws..., n_steps)
    end |> shuffle
    (;
        # test = ForceHoverTrial(RandomGenerator(10); kws..., n_steps=3),
        test = ForceHoverTrial(RolloutGenerator(1); kws..., n_steps=2),
        intro,
        collect_all = sample_problem(; rewards=shuffle(rewards), kws...),
        learn_rewards,
        move2 = [sample_problem(;kws..., n_steps=2) for _ in 1:3],
        practice_revealed = [sample_problem(;kws..., n_steps) for n_steps in 3:5],
        intro_hover = rollout_trial(3; kws..., n_steps=3),
        practice_hover = [sample_problem(;kws..., n_steps) for n_steps in 3:5],
        main,
        # vary_transition = sample_problem(;n, rdist),
        # calibration = intro,
        # eyetracking = [sample_problem(;kws..., n_steps) for n_steps in shuffle(repeat(3:5, 7))]
    )
end


# %% --------

function reward_graphics(n=8)
    emoji = [
        "🎈","🎀","📌","✏️","🔮","⚙️","💡","⏰",
        "✈️","🍎","🌞","⛄️","🐒","👟","🤖",
    ]
    Dict(zip(exponential_rewards(n), sample(emoji, n; replace=false)))
end

version = "v10"
Random.seed!(hash(version))
subj_trials = repeatedly(make_trials, 1)

# %% --------

base_params = (
    eye_tracking = false,
    hover_edges = true,
    hover_rewards = true,
    points_per_cent = 3,
    use_n_steps = true,
    vary_transition = false,
    # linear_rewards = true,
)

dest = "static/json/config"
rm(dest, recursive=true)
mkpath(dest)
foreach(enumerate(subj_trials)) do (i, trials)
    parameters = (;
        base_params...,
        rewardGraphics = reward_graphics(8),
    )
    write("$dest/$i.json", json((;parameters, trials)))
    println("$dest/$i.json")

end

# %% --------

value(t::ForceHoverTrial) = value(t.p)

bonus = map(subj_trials) do trials
    trials = mapreduce(vcat, [:main, :eyetracking]) do t
        get(trials, t, [])
    end
    points = 50 + sum(value.(trials))
    points / (base_params.points_per_cent * 100)
end

using UnicodePlots
if length(bonus) > 1
    display(histogram(bonus, nbins=10, vertical=true, height=10))
end
