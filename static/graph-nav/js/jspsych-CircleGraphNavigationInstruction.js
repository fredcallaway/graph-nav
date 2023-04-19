import {numString, markdown, makePromise, parseHTML, trialErrorHandling, graphicsUrl, setTimeoutPromise, addPlugin, documentEventPromise, invariant, makeButton, sleep} from './utils.js';
import _ from '../../lib/underscore-min.js'
import $ from '../../lib/jquery-min.js';
import jsPsych from '../../lib/jspsych-exported.js';
import {bfs} from './graphs.js';
import {queryEdge, CircleGraph, renderSmallEmoji} from './jspsych-CircleGraphNavigation.js';

window._ = _

function button(txt='continue', options={}) {
  return makeButton($("#cgi-top"), txt, {
    css: {'margin-top': '8px'},
    pre_delay: 0,
    // pre_delay: 2,
    post_delay: 0.2,
    ...options
  })
}

function message(html) {
  $('#cgi-msg').html(html)
}

function setup(root, trial) {
  let top = $('<div>', {id: 'cgi-top'}).appendTo(root).css({
    'height': '120px',
    'width': '800px'
  })
  $('<p>', {id: "cgi-msg"}).appendTo(top).css('font-size', '16pt')
  $('<div>', {id: "cgi-root"}).appendTo(root)
}

addPlugin('intro', async function(root, trial) {
  trial = {
    ...trial,
    hover_edges: false,
    hover_rewards: false,
    show_points: false,
    show_steps: false,
    rewards: Array(8).fill(0)
  }
  setup(root, trial)
  let cg = new CircleGraph($("#cgi-root"), trial);

  message(`Welcome! In this experiment, you will play a game on the board shown below.`)
  await button()

  message(`Your current location on the board is highlighted in blue.`)
  cg.setCurrentState(trial.start)
  // $(".GraphNavigation-currentEdge").removeClass('GraphNavigation-currentEdge')
  await button()

  message(`You can move between locations that are connected by a line.`)
  await button()

  message(`You move to a location by clicking on it. Try it now!`)
  console.log('cg.graph', cg.graph)
  // cg.setCurrentState(trial.start)
  await cg.navigate({n_steps: 1, leave_state: true})

  message(`
    The goal of the game is to earn points by collecting items from the board.<br>
    Try collecting this item!
  `)
  let goal = _.sample(cg.graph.successors(cg.state))
  $("#gn-points").show()
  cg.setReward(goal, 10)
  console.log('goal', goal)
  await cg.navigate({n_steps: -1, goal, leave_state: true})

  message(`
    Nice! You got 10 points for collecting that item. What about this one?
  `)
  goal = _.sample(cg.graph.successors(cg.state))
  cg.setReward(goal, -5)
  await cg.navigate({n_steps: -1, goal, leave_open: true})

  message(`<i>Ouch!</i> You lost 5 points for collecting that one!`)
  cg.removeGraph()
  await button()

  $(root).empty()
  jsPsych.finishTrial(cg.data)
})


addPlugin('collect_all', async function(root, trial) {
  trial = {
    ...trial,
    hover_edges: false,
    hover_rewards: false,
    show_steps: false,
  }
  setup(root, trial)

  let vals = _.sortBy(_.without(_.keys(trial.rewardGraphics), "0"), parseFloat)
  let descriptions = vals.map(reward => {
    return `${renderSmallEmoji(trial.rewardGraphics[reward])} is worth ${reward}`
  })
  let spec = descriptions.slice(0, -1).join(', ') + ', and ' + descriptions.slice(-1)
  message(`Each kind of item is worth a different number of points:<br>` + spec)
  await button()

  message(`
    Try collecting all the items (even the bad ones for now).
  `)
  let cg = new CircleGraph($("#cgi-root"), trial);
  await cg.navigate({
    n_steps: -1,
    leave_open: true,
    termination: (cg, s) => !_.some(cg.rewards)
  })

  cg.removeGraph()
  message(`
    Nice work! But in the real game, you should try to avoid the bad items.
  `)
  await button()

  $(root).empty()
  jsPsych.finishTrial(cg.data)
})


addPlugin('easy', async function(root, trial) {
  trial = {
    ...trial,
    hover_edges: false,
    hover_rewards: false,
  }
  setup(root, trial)
  message(`
    On each turn, you have to make some number of moves.<br>
    The number of moves left is shown on the left, under your score.
  `)
  let cg = new CircleGraph($("#cgi-root"), trial);
  $(cg.el).hide()
  $("#GraphNavigation-steps").html(trial.n_steps)

  await button()
  $(cg.el).show()


  message(`Let's try an easy one. Try to make as many points as you can in just one move!`)

  await cg.navigate({leave_open: true})

  let best_item = renderSmallEmoji(trial.rewardGraphics[10])
  if (cg.score == trial.max_val) {
    message("Awesome! That was the most points you could have made.")
    // $(cg.el).animate({opacity: 0.2}, 300);

  } else {
    message(`Hmm... you should be able to make ${trial.max_val} points. Why don't we try again?`)
    cg.logger('try_again')
    $(cg.el).animate({opacity: 0.2}, 300);
    await button("reset")

    message(`Hint: the ${best_item} is worth the most!`)
    $(cg.el).animate({opacity: 1}, 100);
    cg.setScore(0)
    cg.loadTrial(trial)
    await cg.navigate({leave_open: true})

    // $(cg.el).animate({opacity: 0.2}, 300);
    if (cg.score == trial.max_val) {
      message("That's more like it! Well done!")
    } else {
      message("Not quite, but let's move on for now.")
    }
  }
  cg.removeGraph()
  await button()

  $(root).empty()
  jsPsych.finishTrial(cg.data)
});


addPlugin('practice', async function(root, trial) {
  trial = {
    ...trial,
    hover_edges: false,
    hover_rewards: false,
  }
  setup(root, trial)

  message(trial.message)
  if (trial.first) await button()

  cg = new CircleGraph($("#cgi-root"), trial);
  await cg.navigate()
  $(root).empty()
  jsPsych.finishTrial(cg.data)


  // message("OK, let's step it up a notch. Try a few two-move games.")
  // // $(cg.el).animate({opacity: 0.2}, 300);
  // await button()

  // for (let trial of trials.move2) {
  //   cg = new CircleGraph(cg_root, {...info, ...trial});
  //   await cg.navigate({leave_open: true})
  // }

  // message("How about three moves?")
  // // $(cg.el).animate({opacity: 0.2}, 300);
  // await button()

  // for (let trial of trials.move3) {
  //   cg = new CircleGraph(cg_root, {...info, ...trial});
  //   await cg.navigate({leave_open: true})
  // }

  // $(this.el).animate({opacity: 0}, 500)

})


  // message(`
  //   Nice work! But now we're going to make things a little harder...
  // `)
  // fillRewards()
  // await button()

  // cg.el.classList.add('hideStates')
  // cg.el.classList.add('hideEdges')

  // message(`
  //   In the real game, you don't get to see
  // `)
// });
