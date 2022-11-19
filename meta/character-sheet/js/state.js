let subscribers = [];

export function publish(eventName, payload) {
  subscribers.forEach((subscriber) => {
    if (subscriber.eventName !== eventName) return;
    subscriber.callbackFn(payload);
  });
}

export function subscribe(eventName, callbackFn) {
  // TODO: detect duplicate subscriptions
  subscribers.push({ eventName, callbackFn });
}
