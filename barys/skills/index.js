import { registerSkill } from "../kernel.js";
import { aboutSkill } from "./about.js";
import { catalogSkill } from "./catalog.js";
import { contactsSkill } from "./contacts.js";
import { currencySkill } from "./currency.js";
import { deliverySkill } from "./delivery.js";
import { orderSkill } from "./order.js";
import { smalltalkCloseSkill, smalltalkSkill } from "./smalltalk.js";

registerSkill(smalltalkSkill);
registerSkill(contactsSkill);
registerSkill(orderSkill);
registerSkill(deliverySkill);
registerSkill(currencySkill);
registerSkill(aboutSkill);
registerSkill(catalogSkill);
registerSkill(smalltalkCloseSkill);
