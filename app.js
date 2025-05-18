const { App } = require('@slack/bolt');
require('dotenv').config();

// Initializes your app with your bot token and signing secret
const app = new App({
  token: process.env.SLACK_BOT_TOKEN,
  signingSecret: process.env.SLACK_SIGNING_SECRET,
  socketMode: true,
  appToken: process.env.SLACK_APP_TOKEN
});

(async () => {
  // Start your app
  await app.start(process.env.PORT || 3000);

  console.log('⚡️ Bolt app is running!');
})();

// Listen for a slash command invocation
app.command('/hello-bolt-app', async ({ ack, body, client }) => {
  // Acknowledge the command request
  await ack();

  try {
    // Call views.publish with the built-in client
    const result = await client.chat.postMessage({
      channel: body.channel_id,
      text: "Hello world"
    });
    console.log(result);
  }
  catch (error) {
    console.error(error);
  }
});

// Listen for a button press
app.action('button_click', async ({ ack, body, client }) => {
  // Acknowledge the action
  await ack();

  try {
    // Update the message
    await client.chat.update({
      channel: body.channel.id,
      ts: body.message.ts,
      text: 'Button clicked!',
      blocks: [] // Remove buttons after click, or update as needed
    });
  } catch (error) {
    console.error(error);
  }
});

// Example of handling block_actions specifically (e.g., from a modal or interactive message)
app.action({ type: 'block_actions' }, async ({ ack, body, client }) => {
  await ack();
  try {
    if (body.message) {
      const result = await client.chat.update({
        channel: body.channel.id,
        ts: body.message.ts,
        text: `Action ${body.actions[0].action_id} was triggered by <@${body.user.id}>`,
        blocks: [] 
      });
      console.log('Chat updated:', result);
    } else if (body.view) {
      console.log('Block action from view:', body.actions[0]);
    }
  } catch (error) {
    console.error('Error handling block_actions:', error);
  }
});

// Example of handling a view submission (e.g., from a modal)
app.view('modal_view_1', async ({ ack, body, view, client }) => {
  await ack();

  const user = body.user.id;
  // const val = view.state.values.input_block_id.input_action_id.value;

  try {
    // await client.chat.postMessage({
    //   channel: user,
    //   text: `Thanks for your submission: ${val}`
    // });
    console.log('Modal submitted by user:', user);
  } catch (error) {
    console.error('Error handling modal submission:', error);
  }
});

// Catch all for errors
app.error(async (error) => {
  console.error(error);
}); 