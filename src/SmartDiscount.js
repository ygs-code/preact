const processData = smartOrder => {
  const lineItems = smartOrder.line_items.map(item => ({
    ...item,
    original_quantity: item.quantity,
    remit_price: item.price,
    smart_discount_entries: item.smart_discount_entries || []
  }));
  smartOrder.line_items = lineItems
    .sort((a, b) => b.price - a.price)
    .filter(item => item.quantity > 0 && item.remit_price > 0);
  return smartOrder;
};
const findValue = (index, smartOrder, lineItem) => {
  const indexStrs = index.split('.');
  if (indexStrs.length > 1) {
    switch (indexStrs[0]) {
      case 'line_items':
        return lineItem[indexStrs[1]];
      case 'order':
        return smartOrder[indexStrs[1]];
      case 'customer':
        return smartOrder.customer[indexStrs[1]];
    }
  }
  return '';
};
const SmartDiscount = (_smartOrder, _promos) => {
  let smartOrder = processData(_smartOrder);
  let current_node = { nodes: [] };
  let promos = _promos.map(item => eval(item));

  const _do = (node, nodeCache) => {
    const itemString = smartOrder.line_items.toString();
    // const itemCache = nodeCache.get(itemString);
    current_node = node;
    const amount = current_node.amount || 0;
    // if (itemCache) {
    //   const current = amount + itemCache.amount;
    //   if (current_node.amount > current) {
    //     current_node.amount = current;
    //   }
    //   current_node.nodes.push(itemCache);
    // } else {
    promos.forEach(promo => {
      const order = Object.assign({}, smartOrder);
      const lineItems = order.line_items.map(t => ({
        uuid: t.uuid,
        price: t.price,
        quantity: t.quantity,
        original_quantity: t.quantity,
        remit_price: t.price,
        department_id: t.department_id,
        category_id: t.category_id,
        product_id: t.product_id,
        listing_id: t.listing_id,
        amount: t.amount,
        smart_discount_entries: t.smart_discount_entries
      }));
      order.line_items = lineItems;

      const ls = promo.check(order);

      if (ls) {
        const new_node = promo.getReslut(ls);
        nodeCache.set(itemString, new_node);
        SmartDiscount(ls, promos)._do(new_node, nodeCache);
        const current = amount + new_node.amount;
        if (current_node.amount > current) {
          current_node.amount = current;
        }
        current_node.nodes.push(new_node);
      }
    });
    // }
  };
  const Do = () => {
    const levelPromos = [[]];
    //筛选promo
    promos.forEach(promo => {
      let isBack = false;
      for (let i = 0; i < smartOrder.line_items.length; i++) {
        const lienItem = smartOrder.line_items[i];
        for (let j = 0; j < promo.conditions.length; j++) {
          const condition = promo.conditions[j];
          for (let m = 0; m < condition.cs.length; m++) {
            const c = condition.cs[m];
            const value = findValue(c.index, smartOrder, lienItem);
            let matched = value == c.value;
            if (c.symbol == 'in') {
              matched = c.value.some(v => v == value);
            }
            if (matched) {
              if (!levelPromos[promo.level - 1]) {
                levelPromos[promo.level - 1] = [];
              }
              levelPromos[promo.level - 1].push(promo);
              isBack = true;
              break;
            }
          }
          if (isBack) {
            break;
          }
        }
        if (isBack) {
          break;
        }
      }
    });
    let result = [];
    let nodeCache = new Map();
    levelPromos.forEach(item => {
      promos = item;
      _do(current_node, nodeCache);
      result = getResultForLineItems();
      smartOrder = result;
      current_node = { nodes: [] };
      nodeCache = new Map();
    });
    return result;
  };

  const getResultForLineItems = () => {
    let tree = Object.assign({}, current_node);
    if (tree.nodes.length > 0) {
      tree.nodes.sort((a, b) => a.amount - b.amount);
      smartOrder.initial_discount = current_node.nodes[0].amount;
    }
    while (tree.nodes.length > 0) {
      tree.nodes.sort((a, b) => a.amount - b.amount);
      const node = tree.nodes[0];
      tree = node;
      const chooseItems = node.chooseItems || [];
      let total = 0;
      chooseItems.forEach(chooseItme => {
        total +=
          chooseItme.price *
          (chooseItme.original_quantity - chooseItme.quantity);
      });
      tree.nodes.sort((a, b) => a.amount - b.amount);
      const nextNode = tree.nodes[0];
      const nextAmount = nextNode ? nextNode.amount : 0;
      const remitAmount = tree.amount - nextAmount;
      const lineItems = smartOrder.line_items;
      let lineItemDiscountAmountTotal = 0;
      chooseItems.forEach((chooseItme, postion) => {
        lineItems.forEach((lineitem, index) => {
          if (lineitem.uuid == chooseItme.uuid) {
            const itemTotalPrice =
              chooseItme.price *
              (chooseItme.original_quantity - chooseItme.quantity);
            const itemReduceAmount = (remitAmount * itemTotalPrice) / total;
            lineItems[index].smart_discount_entries.push({
              discount_name: node.promo.name,
              amount:
                postion === chooseItems.length - 1
                  ? remitAmount - lineItemDiscountAmountTotal
                  : itemReduceAmount
            });
            lineItemDiscountAmountTotal += itemReduceAmount;
          }
        });
      });

      smartOrder.line_items = lineItems;
    }
    return smartOrder;
  };

  return {
    Do,
    _do,
    getResultForLineItmes: getResultForLineItems
  };
};

class Promo {
  constructor(name) {
    this.conditions = [];
    this.outcomes = [];
    this.name = name;
    this.level = 1;
  }

  static setName(name) {
    return new Promo(name);
  }

  /**
   * level
   */
  setLevel(level) {
    this.level = level;
    return this;
  }

  /**
   * 添加条件
   */
  addCondition(cs, after) {
    this.conditions.push({ cs, after });
    return this;
  }

  /**
   * 作用的结果
   */
  result(outcome) {
    this.outcomes = outcome;
    return this;
  }

  /**
   *
   * @param smartOrder
   * @returns order - 调整过的(执行after逻辑之后的)order
   */
  getReslut(smartOrder) {
    return this.outcomes.calculate(smartOrder, this);
  }

  /**
   * 校验规则是否生效
   * @param smartOrder
   * @returns {boolean}
   */

  check(smartOrder) {
    let lineItems = smartOrder.line_items.map(t => ({
      uuid: t.uuid,
      price: t.price,
      quantity: t.quantity,
      original_quantity: t.quantity,
      remit_price: t.price,
      department_id: t.department_id,
      category_id: t.category_id,
      product_id: t.product_id,
      listing_id: t.listing_id,
      amount: t.amount,
      smart_discount_entries: t.smart_discount_entries
    }));
    let matched = true;
    for (let k = 0; k < this.conditions.length; k++) {
      const cs = this.conditions[k].cs;
      const after = this.conditions[k].after;
      const matchedLineItem = lineItems.filter(lineItem => {
        let lineItemMatched = true;
        for (let j = 0; j < cs.length; j++) {
          const condition = cs[j];
          if (!condition.check(smartOrder, lineItem)) {
            lineItemMatched = false;
            break;
          }
        }
        return lineItemMatched;
      });
      if (matchedLineItem && matchedLineItem.length > 0) {
        const afterReslut = after.execute(matchedLineItem, smartOrder);
        if (!afterReslut) {
          matched = false;
          break;
        }
      } else {
        matched = false;
        break;
      }
      if (k != 0) {
        lineItems = lineItems.filter(item => item.remit_price > 0);
      }
    }
    smartOrder.line_items = lineItems;
    return matched && smartOrder;
  }
}

class Condition {
  constructor(index, symbol, value) {
    this.index = index;
    this.symbol = symbol;
    this.value = value;
  }

  check(smartOrder, lineItem) {
    const key = findValue(this.index, smartOrder, lineItem);
    let result = false;
    switch (this.symbol) {
      case 'in':
        result = this.value.some(v => v == key);
        break;
      case 'find':
        result = key.some(v => v == this.value);
        break;
      case '>=':
        result = key >= this.value;
        break;
      case '<=':
        result = key <= this.value;
        break;
      case '=':
        result = key == this.value;
        break;
      case '!=':
        result = key != this.value;
        break;
    }
    return result;
  }
}

class After {
  constructor(index, symbol, value) {
    this.index = index;
    this.symbol = symbol;
    this.value = value;
    this.basePrice = -1;
  }

  setBasePrice(basePrice) {
    this.basePrice = basePrice;
    return this;
  }

  execute(lineItems, smartOrder) {
    if (this.symbol === '/') {
      const totalQuantity = lineItems
        .map(item => item.quantity)
        .reduce((prev, next) => prev + next, 0);
      const value = Math.floor(totalQuantity / this.value);
      if (value) {
        Object.assign(smartOrder, {
          temporaryChange: {
            changeQuantity: value
          }
        });
        lineItems.sort((a, b) => a.price - b.price);
        this.value = value * this.value;
      }
      this.symbol = '=';
    }
    let result = -Number(this.value);
    for (let i = 0; i < lineItems.length; i++) {
      const lineItem = lineItems[i];
      const smartDiscounts = lineItem.smart_discount_entries || [];
      let quantity = 1;
      if (this.index != 'quantity') {
        quantity = lineItem['quantity'];
        const discountAmount = smartDiscounts
          .map(smartDiscount => smartDiscount.amount)
          .reduce((prev, next) => prev + next, 0);
        result += discountAmount;
      }
      if (quantity != 0) {
        if (this.basePrice !== -1 && this.basePrice > lineItem.price) {
          lineItem.basePrice = this.basePrice;
        } else {
          lineItem.basePrice = lineItem.price;
        }
        if (result !== -0.0001) {
          // 说明条件还不满足 >= 条件
          result += lineItem[this.index] * quantity;
        }
        if (result <= lineItem[this.index] * quantity) {
          if (this.index != 'quantity') {
            if (lineItem['quantity'] != lineItem['original_quantity']) {
              lineItem['original_quantity'] -= lineItem['quantity'];
            } else {
              lineItem[this.index] = 0;
            }
            lineItem['quantity'] = 0;
          } else {
            lineItem[this.index] = 0;
            // lineItem[this.index] = Math.max(0, result);
          }
        } else {
          lineItem[this.index] = result;
        }

        if (result >= 0) {
          if (this.symbol == '=') {
            break;
          } else if (this.symbol == '>=') {
            // 当>时为了让result 永远<lineItem[this.index] * quantity
            result = -0.0001;
          }
        }
      }
    }
    return result >= -0.0001;
  }
}

class Outcome {
  constructor(Choose, discount) {
    this.Choose = Choose;
    this.discount = discount;
    this.result = [];
  }

  _filterItem(items = [], symbol, props, value) {
    return items.filter(item => {
      switch (symbol) {
        case '>=':
          return item[props] >= value;
        case '=':
          return item[props] == value;
        case '<=':
          return item[props] <= value;
        case '!=':
          return item[props] <= value;
        case 'in':
          return value.includes(item[props]);
      }
    });
  }

  _filterItems(conditions = [], items = []) {
    if (conditions.length === 0 || items.length === 0) return;

    const [condition, ...restConditions] = conditions;

    if (condition === null) {
      this.result = items;
      return;
    }
    const [type, props, ...rest] = condition.index.split('.');
    const { symbol, value } = condition;

    if (type === 'line_items') {
      this.result = this._filterItem(items, symbol, props, value);
    }
    this._filterItems(restConditions, this.result);
  }

  _getAmount(discount, totalPrice, diff = 0) {
    let amount = 0;
    if (discount.includes('%')) {
      const percent = parseInt(discount, 10);
      amount = (totalPrice * percent) / 100;
    } else if (discount.includes('=')) {
      const net = parseInt(discount.replace('=', ''), 10);
      amount = net - totalPrice;
    } else {
      amount = parseInt(discount, 10) - diff;
    }
    console.info(totalPrice)
    return amount;
  }

  calculate(smartOrder, promo) {
    const discount = this.discount;
    const lineItems = smartOrder.line_items.filter(
      item => item.original_quantity != item.quantity
    );
    const node = {
      nodes: [],
      promo,
      chooseItems: [],
      amount: 0
    };

    if (this.Choose === null) {
      node.chooseItems = lineItems;
      const totalPrice = lineItems
        .map(
          item =>
            (item.original_quantity - item.quantity) * item.price +
            (item.smart_discount_entries || [])
              .map(v => v.amount)
              .reduce((prev, next) => prev + next, 0)
        )
        .reduce((prev, next) => prev + next, 0);
      const diff = lineItems
        .map(
          item =>
            (item.original_quantity - item.quantity) *
            (item.price - item.basePrice)
        )
        .reduce((prev, next) => prev + next, 0);

      node.amount = this._getAmount(discount, totalPrice, diff);
    } else {
      if (smartOrder.temporaryChange) {
        this.Choose.quantity = smartOrder.temporaryChange.changeQuantity;
        smartOrder.temporaryChange = undefined;
      }
      const conditions = this.Choose.conditions;
      let quantity = this.Choose.quantity;
      if (quantity !== undefined) {
        let targetItems;
        if (!conditions) {
          targetItems = lineItems;
        } else {
          this._filterItems(conditions, lineItems);
          targetItems = this.result;
        }

        const len = targetItems.length;
        let totalPrice = 0;
        if (len !== 0) {
          for (let i = len - 1; i >= 0; i--) {
            const quantityDiff =
              targetItems[i].original_quantity - targetItems[i].quantity;
            if (quantity <= quantityDiff) {
              targetItems[i].quantity =
                targetItems[i].original_quantity - quantity;

              node.chooseItems.push(targetItems[i]);
              totalPrice +=
                targetItems[i].price * quantity +
                (targetItems[i].smart_discount_entries || [])
                  .map(v => v.amount)
                  .reduce((prev, next) => prev + next, 0);
              break;
            } else {
              quantity = quantity - quantityDiff;
              node.chooseItems.push(targetItems[i]);
              totalPrice +=
                targetItems[i].price * quantityDiff +
                (targetItems[i].smart_discount_entries || [])
                  .map(v => v.amount)
                  .reduce((prev, next) => prev + next, 0);
            }
          }
          node.amount = this._getAmount(discount, totalPrice);
        }
      } else {
        let targetItems;
        if (!conditions) {
          targetItems = lineItems;
        } else {
          this._filterItems(conditions, lineItems);
          targetItems = this.result;
        }

        const len = targetItems.length;
        let totalPrice = 0;
        if (len !== 0) {
          for (let i = len - 1; i >= 0; i--) {
            quantity =
              targetItems[i].original_quantity - targetItems[i].quantity;
            targetItems[i].quantity =
              targetItems[i].original_quantity - quantity;

            node.chooseItems.push(targetItems[i]);
            totalPrice +=
              targetItems[i].price * quantity +
              (targetItems[i].smart_discount_entries || [])
                .map(v => v.amount)
                .reduce((prev, next) => prev + next, 0);
          }
          node.amount = this._getAmount(discount, totalPrice);
        }
      }
    }

    return node;
  }
}

const Choose = (conditions = null, quantity) => {
  return { conditions, quantity };
};

if (module) {
  module.exports = {
    SmartDiscount
  };
}
